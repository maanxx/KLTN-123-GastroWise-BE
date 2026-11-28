import { ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import {
  assertLocalIngestionTargetOnly,
  buildRawStagingDocuments,
  computeBatchChecksumSha256,
  EXTERNAL_SOURCE_FOODY,
  INGESTION_BATCHES_COLLECTION,
  IngestionValidationError,
  parseIngestionCliArgs,
  parseRawIngestionInput,
  RAW_STAGING_COLLECTION,
  RESTAURANTS_COLLECTION,
  rollbackIngestionBatch,
  runRestaurantIngestionPipeline,
  validateAndNormalizeRestaurantRecord,
} from './index';

type StoredDoc = Record<string, unknown> & { _id: ObjectId | string };

function matchesFilter(
  doc: StoredDoc,
  filter: Record<string, unknown>,
): boolean {
  for (const [key, cond] of Object.entries(filter)) {
    if (key === '$or' && Array.isArray(cond)) {
      const anyMatch = cond.some((sub) =>
        matchesFilter(doc, sub as Record<string, unknown>),
      );
      if (!anyMatch) return false;
      continue;
    }

    const val = doc[key];
    if (
      cond &&
      typeof cond === 'object' &&
      !Array.isArray(cond) &&
      !(cond instanceof ObjectId)
    ) {
      const condObj = cond as Record<string, unknown>;
      if ('$in' in condObj && Array.isArray(condObj.$in)) {
        const matched = condObj.$in.some(
          (item) => String(item) === String(val),
        );
        if (!matched) return false;
        continue;
      }
      if ('$exists' in condObj) {
        const exists = val !== undefined;
        if (Boolean(condObj.$exists) !== exists) return false;
        continue;
      }
    }

    if (cond instanceof ObjectId) {
      if (String(val) !== cond.toString()) return false;
    } else if (val !== cond) {
      return false;
    }
  }
  return true;
}

function applyUpdate(doc: StoredDoc, update: Record<string, unknown>): void {
  const setFields = update.$set as Record<string, unknown> | undefined;
  const setOnInsert = update.$setOnInsert as
    | Record<string, unknown>
    | undefined;
  const unsetFields = update.$unset as Record<string, unknown> | undefined;

  if (setFields) {
    for (const [k, v] of Object.entries(setFields)) {
      doc[k] = v;
    }
  }
  if (setOnInsert) {
    for (const [k, v] of Object.entries(setOnInsert)) {
      if (doc[k] === undefined) {
        doc[k] = v;
      }
    }
  }
  if (unsetFields) {
    for (const k of Object.keys(unsetFields)) {
      delete doc[k];
    }
  }
}

class InMemoryMongoCollection {
  constructor(public readonly docs: StoredDoc[] = []) {}

  find(filter: Record<string, unknown> = {}) {
    const matched = this.docs.filter((d) => matchesFilter(d, filter));
    return {
      toArray: () => Promise.resolve(matched.map((d) => ({ ...d }))),
    };
  }

  findOne(filter: Record<string, unknown> = {}): Promise<StoredDoc | null> {
    const found = this.docs.find((d) => matchesFilter(d, filter));
    return Promise.resolve(found ? { ...found } : null);
  }

  insertOne(doc: Record<string, unknown>) {
    const stored: StoredDoc = {
      ...doc,
      _id: (doc._id as ObjectId | string | undefined) ?? new ObjectId(),
    };
    this.docs.push(stored);
    return Promise.resolve({ insertedId: stored._id });
  }

  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: { upsert?: boolean } = {},
  ) {
    const existing = this.docs.find((d) => matchesFilter(d, filter));
    if (existing) {
      applyUpdate(existing, update);
      return Promise.resolve({
        matchedCount: 1,
        modifiedCount: 1,
        upsertedCount: 0,
      });
    }
    if (options.upsert) {
      const created: StoredDoc = {
        ...(typeof filter._id === 'string' || filter._id instanceof ObjectId
          ? { _id: filter._id }
          : { _id: new ObjectId() }),
        ...(typeof filter.batchId === 'string'
          ? { batchId: filter.batchId }
          : {}),
        ...(typeof filter.recordIndex === 'number'
          ? { recordIndex: filter.recordIndex }
          : {}),
      };
      applyUpdate(created, update);
      this.docs.push(created);
      return Promise.resolve({
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 1,
      });
    }
    return Promise.resolve({
      matchedCount: 0,
      modifiedCount: 0,
      upsertedCount: 0,
    });
  }

  deleteMany(filter: Record<string, unknown>) {
    let deletedCount = 0;
    for (let i = this.docs.length - 1; i >= 0; i -= 1) {
      if (matchesFilter(this.docs[i], filter)) {
        this.docs.splice(i, 1);
        deletedCount += 1;
      }
    }
    return Promise.resolve({ deletedCount });
  }

  async bulkWrite(ops: Array<Record<string, unknown>>) {
    let insertedCount = 0;
    let matchedCount = 0;
    let modifiedCount = 0;
    let upsertedCount = 0;

    for (const op of ops) {
      if (op.insertOne) {
        const doc = (op.insertOne as { document: Record<string, unknown> })
          .document;
        await this.insertOne(doc);
        insertedCount += 1;
      } else if (op.updateOne) {
        const spec = op.updateOne as {
          filter: Record<string, unknown>;
          update: Record<string, unknown>;
          upsert?: boolean;
        };
        const res = await this.updateOne(spec.filter, spec.update, {
          upsert: spec.upsert,
        });
        matchedCount += res.matchedCount;
        modifiedCount += res.modifiedCount;
        upsertedCount += res.upsertedCount;
      }
    }

    return { insertedCount, matchedCount, modifiedCount, upsertedCount };
  }
}

function createInMemoryDb(initialRestaurants: StoredDoc[] = []): {
  db: Db;
  collections: Record<string, InMemoryMongoCollection>;
} {
  const collections: Record<string, InMemoryMongoCollection> = {
    [RESTAURANTS_COLLECTION]: new InMemoryMongoCollection(initialRestaurants),
    [RAW_STAGING_COLLECTION]: new InMemoryMongoCollection(),
    [INGESTION_BATCHES_COLLECTION]: new InMemoryMongoCollection(),
  };

  const db = {
    databaseName: 'gastro_core_test',
    collection: (name: string) => {
      if (!collections[name]) {
        collections[name] = new InMemoryMongoCollection();
      }
      return collections[name];
    },
  } as unknown as Db;

  return { db, collections };
}

describe('M10.2 Controlled ShopeeFood Ingestion Pipeline', () => {
  describe('Safety guards & CLI arg validation', () => {
    it('blocks Atlas mongodb+srv:// and remote hosts unconditionally and allows localhost/docker mongo-test', () => {
      expect(() =>
        assertLocalIngestionTargetOnly(
          'mongodb+srv://user:pass@cluster0.xyz.mongodb.net/gastro_core',
        ),
      ).toThrow(IngestionValidationError);

      expect(() =>
        assertLocalIngestionTargetOnly(
          'mongodb://user:pass@cluster0-shard.mongodb.net:27017/gastro_core',
        ),
      ).toThrow(IngestionValidationError);

      expect(() =>
        assertLocalIngestionTargetOnly(
          'mongodb://127.0.0.1:27017/gastro_core_test',
        ),
      ).not.toThrow();

      expect(() =>
        assertLocalIngestionTargetOnly(
          'mongodb://gastro_core_svc:pass@mongo-test:27017/gastro_core_test?authSource=gastro_core_test',
        ),
      ).not.toThrow();
    });

    it('defaults CLI to dry-run and blocks --allow-atlas / inline credential flags', () => {
      const parsed = parseIngestionCliArgs([
        '--file=scripts/ingestion/fixtures/sample_shopeefood_raw.json',
      ]);
      expect(parsed.mode).toBe('dry-run');
      expect(parsed.dryRun).toBe(true);

      expect(() =>
        parseIngestionCliArgs(['--file=sample.json', '--allow-atlas']),
      ).toThrow(IngestionValidationError);

      expect(() =>
        parseIngestionCliArgs([
          '--file=sample.json',
          '--uri=mongodb://localhost',
        ]),
      ).toThrow(IngestionValidationError);

      const rollbackPreview = parseIngestionCliArgs(['--rollback=batch_123']);
      expect(rollbackPreview.mode).toBe('rollback');
      expect(rollbackPreview.dryRun).toBe(true);
    });
  });

  describe('Staging & field-level normalization', () => {
    it('parses JSON & JSONL formats, preserves raw payload, and computes SHA-256 batch checksums', () => {
      const jsonl = `${JSON.stringify({ RestaurantID: 1, Name: 'Pho A' })}\n${JSON.stringify({ RestaurantID: 2, Name: 'Pho B' })}\n`;
      const parsed = parseRawIngestionInput(jsonl, 'jsonl');
      expect(parsed).toHaveLength(2);

      const sha = computeBatchChecksumSha256(jsonl);
      const staged = buildRawStagingDocuments(parsed, {
        batchId: 'batch_test_1',
        checksumSha256: sha,
      });
      expect(staged[0].source).toBe(EXTERNAL_SOURCE_FOODY);
      expect(staged[0].sourceId).toBe('1');
      expect(staged[0].batchChecksumSha256).toBe(sha);
      expect(staged[0].payload).toEqual({ RestaurantID: 1, Name: 'Pho A' });
    });

    it('normalizes valid records, rejects missing name/id, handles invalid coords & missing/zero prices, and preserves rating scales', () => {
      // Valid 10-pt Foody doc with nested AvgPointList & duplicate mixed tags
      const validFoody = validateAndNormalizeRestaurantRecord(
        {
          recordIndex: 0,
          payload: {
            RestaurantID: 1163155,
            Name: 'Phở Hùng',
            Address: '241 Nguyễn Trãi, Quận 1',
            CityID: 217,
            Latitude: 10.76645,
            Longtitude: 106.68972,
            AvgRating: 8.4,
            TotalReview: 148,
            AvgPointList: [
              { Label: 'Chất lượng', Point: 8.7 },
              { Label: 'Vị trí', Point: 8.5 },
            ],
            PriceMin: 55000,
            PriceMax: 95000,
            OpeningTime: [
              {
                TimeOpen: { Hours: 6, Minutes: 0 },
                TimeClose: { Hours: 23, Minutes: 0 },
              },
            ],
            Cuisines: [{ Name: 'Món Việt' }],
            LstCategory: [{ Name: 'Mì phở' }],
            tags: ['mì phở', 'Phở bò, món việt'],
            PictureModel: { ImageUrl: 'https://cdn.example.com/pho.jpg' },
            MicrositeUrl: '/ho-chi-minh/pho-hung',
          },
        },
        'batch_1',
      );
      expect(validFoody.candidate).not.toBeNull();
      expect(validFoody.candidate?.externalSourceId).toBe('1163155');
      expect(validFoody.candidate?.diemTrungBinh).toBe(4.2);
      expect(validFoody.candidate?.rawRating).toBe(8.4);
      expect(validFoody.candidate?.ratingScale).toBe('10_point');
      expect(validFoody.candidate?.foodyReviewsCount).toBe(148);
      expect(validFoody.candidate?.giaCa).toBe('55.000đ - 95.000đ');
      expect(validFoody.candidate?.gioMoCua).toBe('06:00 - 23:00');
      expect(validFoody.candidate?.tags).toBe('mì phở, Phở bò, món việt');
      expect(validFoody.candidate?.location).toEqual({
        type: 'Point',
        coordinates: [106.68972, 10.76645],
      });

      // Missing Name & RestaurantID rejected with structured errors
      const missingFields = validateAndNormalizeRestaurantRecord(
        { recordIndex: 1, payload: { Address: 'Q1' } },
        'batch_1',
      );
      expect(missingFields.candidate).toBeNull();
      expect(missingFields.errors.map((e) => e.errorCode)).toEqual([
        'MISSING_EXTERNAL_ID',
        'MISSING_NAME',
      ]);

      // [0, 0] coords & 0 price never fabricated; 5-point scale honored explicitly
      const invalidCoordsZeroPrice = validateAndNormalizeRestaurantRecord(
        {
          recordIndex: 2,
          payload: {
            RestaurantID: 2000451,
            Name: 'Cơm Tấm Null Island',
            Latitude: 0,
            Longtitude: 0,
            PriceMin: 0,
            PriceMax: 0,
            AvgRating: 4.2,
            ratingScale: '5_point',
          },
        },
        'batch_1',
      );
      expect(invalidCoordsZeroPrice.candidate?.location).toBeNull();
      expect(invalidCoordsZeroPrice.candidate?.giaCa).toBe('');
      expect(invalidCoordsZeroPrice.candidate?.diemTrungBinh).toBe(4.2);
      expect(invalidCoordsZeroPrice.candidate?.ratingScale).toBe('5_point');
      expect(invalidCoordsZeroPrice.invalidOrMissingCoords).toBe(true);
      expect(invalidCoordsZeroPrice.missingPrice).toBe(true);

      // Ambiguous [0, 5] rating on non-Foody source without explicit scale flagged explicitly
      const ambiguousDoc = validateAndNormalizeRestaurantRecord(
        {
          recordIndex: 3,
          payload: {
            RestaurantID: 3000100,
            externalSource: 'partner_csv',
            Name: 'Ambiguous Cafe',
            AvgRating: 4.1,
            Latitude: 10.77,
            Longtitude: 106.7,
          },
        },
        'batch_1',
      );
      expect(ambiguousDoc.candidate?.ratingScale).toBe('ambiguous');
      expect(ambiguousDoc.candidate?._ratingNormalized).toBe(false);
      expect(ambiguousDoc.ratingKind).toBe('ambiguous');
    });
  });

  describe('Deduplication, user-field preservation, idempotence, dry-run & rollback', () => {
    const sampleBatch = JSON.stringify([
      {
        RestaurantID: 101,
        Name: 'Phở Hòa',
        Address: '260C Pasteur, Quận 3',
        Latitude: 10.783,
        Longtitude: 106.688,
        AvgRating: 8.6,
        TotalReview: 200,
        PriceMin: 60000,
        PriceMax: 90000,
        Cuisines: [{ Name: 'Phở' }],
        ResUrlRewrite: 'pho-hoa-pasteur',
      },
      {
        RestaurantID: 101,
        Name: 'Phở Hòa Duplicate ExternalId',
        Address: '260C Pasteur, Quận 3',
        Latitude: 10.783,
        Longtitude: 106.688,
        AvgRating: 8.6,
      },
      {
        RestaurantID: 999,
        Name: 'phở hòa',
        Address: '260c  Pasteur,   Quận 3',
        Latitude: 10.783,
        Longtitude: 106.688,
        AvgRating: 8.6,
      },
      {
        RestaurantID: 202,
        Name: 'Bún Bò Huế',
        Address: '10 Lê Lợi, Quận 1',
        Latitude: 10.775,
        Longtitude: 106.701,
        AvgRating: 0.0,
        PriceMin: 0,
        PriceMax: 0,
      },
      {
        Name: 'Invalid Missing ID',
        Address: 'No ID',
      },
    ]);

    it('produces zero DB writes in dry-run mode while reporting exact metrics', async () => {
      const { db, collections } = createInMemoryDb();

      const summary = await runRestaurantIngestionPipeline(db, {
        rawContent: sampleBatch,
        mode: 'dry-run',
      });

      expect(summary.rawStagedCount).toBe(0);
      expect(summary.plannedInserts).toBe(2);
      expect(summary.plannedUpdates).toBe(0);
      expect(summary.metrics).toMatchObject({
        raw_scraped_count: 5,
        valid_record_count: 2,
        inserted_count: 0,
        updated_count: 0,
        rejected_count: 1,
        duplicate_count: 2,
        rating_10pt_explicit_count: 1,
        rating_unrated_zero_count: 1,
        missing_price_count: 1,
      });
      expect(collections[RESTAURANTS_COLLECTION].docs).toHaveLength(0);
      expect(collections[RAW_STAGING_COLLECTION].docs).toHaveLength(0);
      expect(collections[INGESTION_BATCHES_COLLECTION].docs).toHaveLength(0);
    });

    it('performs idempotent bulk upsert, preserves user-owned fields, and cleanly rolls back only batch changes', async () => {
      const userOwnerId = new ObjectId();
      const existingPreUserDocId = new ObjectId();
      const unrelatedDocId = new ObjectId();

      const { db, collections } = createInMemoryDb([
        {
          _id: existingPreUserDocId,
          externalSource: EXTERNAL_SOURCE_FOODY,
          externalSourceId: '101',
          tenQuan: 'Phở Hòa',
          diaChi: '260C Pasteur, Quận 3',
          diemTrungBinh: 4.9,
          reviewsCount: 18,
          ownerId: userOwnerId,
          isVerified: true,
          isFeatured: true,
          giaCa: '55.000đ',
          createdAt: new Date('2025-01-01T00:00:00Z'),
        },
        {
          _id: unrelatedDocId,
          tenQuan: 'Unrelated Existing Restaurant',
          diaChi: '1 Võ Văn Ngân, Thủ Đức',
          reviewsCount: 5,
          isVerified: true,
        },
      ]);

      // Apply batch 1 -> updates 101 (preserving user fields!), inserts 202
      const batch1 = await runRestaurantIngestionPipeline(db, {
        rawContent: sampleBatch,
        batchId: 'batch_apply_1',
        mode: 'apply',
      });

      expect(batch1.metrics.inserted_count).toBe(1);
      expect(batch1.metrics.updated_count).toBe(1);
      expect(collections[RESTAURANTS_COLLECTION].docs).toHaveLength(3);
      expect(collections[RAW_STAGING_COLLECTION].docs).toHaveLength(5);

      const updatedUserDoc = collections[RESTAURANTS_COLLECTION].docs.find(
        (d) => String(d._id) === existingPreUserDocId.toString(),
      );
      expect(updatedUserDoc).toBeDefined();
      expect(updatedUserDoc?.ownerId).toEqual(userOwnerId);
      expect(updatedUserDoc?.reviewsCount).toBe(18);
      expect(updatedUserDoc?.isVerified).toBe(true);
      expect(updatedUserDoc?.isFeatured).toBe(true);
      // Native user-reviewed rating 4.9 must NOT be overwritten by Foody 8.6 -> 4.3
      expect(updatedUserDoc?.diemTrungBinh).toBe(4.9);
      expect(updatedUserDoc?.giaCa).toBe('60.000đ - 90.000đ');

      // Re-run identical batch -> strictly idempotent (0 inserts, 2 updates, still 3 total docs!)
      const batch2 = await runRestaurantIngestionPipeline(db, {
        rawContent: sampleBatch,
        batchId: 'batch_apply_2',
        mode: 'apply',
      });
      expect(batch2.metrics.inserted_count).toBe(0);
      expect(batch2.metrics.updated_count).toBe(2);
      expect(collections[RESTAURANTS_COLLECTION].docs).toHaveLength(3);

      // Rollback batch 2 first, then batch 1 -> unrelated doc stays intact, user doc restores prior giaCa
      await rollbackIngestionBatch(db, 'batch_apply_2', { dryRun: false });
      const rb1 = await rollbackIngestionBatch(db, 'batch_apply_1', {
        dryRun: false,
      });

      expect(rb1.status).toBe('rolled_back');
      expect(rb1.deletedInsertedCount).toBe(1);
      expect(rb1.restoredUpdatedCount).toBe(1);
      expect(collections[RESTAURANTS_COLLECTION].docs).toHaveLength(2);

      const restoredUserDoc = collections[RESTAURANTS_COLLECTION].docs.find(
        (d) => String(d._id) === existingPreUserDocId.toString(),
      );
      expect(restoredUserDoc?.giaCa).toBe('55.000đ');
      expect(restoredUserDoc?.ingestionBatchId).toBeUndefined();

      const unrelated = collections[RESTAURANTS_COLLECTION].docs.find(
        (d) => String(d._id) === unrelatedDocId.toString(),
      );
      expect(unrelated?.tenQuan).toBe('Unrelated Existing Restaurant');
    });
  });
});
