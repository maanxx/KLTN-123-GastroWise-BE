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
  recoverIngestionBatch,
  resolveIngestionDatabaseConfig,
  RESTAURANTS_COLLECTION,
  rollbackIngestionBatch,
  runRestaurantIngestionPipeline,
  STANDALONE_MONGODB_LIMITATION_NOTE,
  validateAndNormalizeRestaurantRecord,
} from './index';

type StoredDoc = Record<string, unknown> & { _id: ObjectId | string };

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }
  if (a instanceof ObjectId || b instanceof ObjectId) {
    return String(a) === String(b);
  }
  return a === b;
}

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
      !(cond instanceof ObjectId) &&
      !(cond instanceof Date)
    ) {
      const condObj = cond as Record<string, unknown>;
      if ('$in' in condObj && Array.isArray(condObj.$in)) {
        const matched = condObj.$in.some((item) => valuesEqual(val, item));
        if (!matched) return false;
        continue;
      }
      if ('$exists' in condObj) {
        const exists = val !== undefined;
        if (Boolean(condObj.$exists) !== exists) return false;
        continue;
      }
      if ('$regex' in condObj && typeof condObj.$regex === 'string') {
        const opts =
          typeof condObj.$options === 'string' ? condObj.$options : '';
        const regex = new RegExp(condObj.$regex, opts);
        if (typeof val !== 'string' || !regex.test(val)) return false;
        continue;
      }
    }

    if (!valuesEqual(val, cond)) {
      return false;
    }
  }
  return true;
}

function applyUpdate(doc: StoredDoc, update: Record<string, unknown>): boolean {
  let modified = false;
  const setFields = update.$set as Record<string, unknown> | undefined;
  const setOnInsert = update.$setOnInsert as
    | Record<string, unknown>
    | undefined;
  const unsetFields = update.$unset as Record<string, unknown> | undefined;

  if (setFields) {
    for (const [k, v] of Object.entries(setFields)) {
      if (!valuesEqual(doc[k], v)) {
        doc[k] = v;
        modified = true;
      }
    }
  }
  if (setOnInsert) {
    for (const [k, v] of Object.entries(setOnInsert)) {
      if (doc[k] === undefined) {
        doc[k] = v;
        modified = true;
      }
    }
  }
  if (unsetFields) {
    for (const k of Object.keys(unsetFields)) {
      if (k in doc) {
        delete doc[k];
        modified = true;
      }
    }
  }
  return modified;
}

class InMemoryMongoCollection {
  public readonly findFilters: Array<Record<string, unknown>> = [];
  public beforeInsertOne?: (doc: Record<string, unknown>) => void;
  public beforeUpdateOne?: (
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
  ) => void;
  public beforeBulkWrite?: (ops: Array<Record<string, unknown>>) => void;

  constructor(public readonly docs: StoredDoc[] = []) {}

  find(filter: Record<string, unknown> = {}) {
    this.findFilters.push({ ...filter });
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
    if (this.beforeInsertOne) {
      this.beforeInsertOne(doc);
    }
    const id = (doc._id as ObjectId | string | undefined) ?? new ObjectId();
    if (this.docs.some((d) => String(d._id) === String(id))) {
      return Promise.reject(
        new Error(`E11000 duplicate key error: ${String(id)}`),
      );
    }
    const stored: StoredDoc = {
      ...doc,
      _id: id,
    };
    this.docs.push(stored);
    return Promise.resolve({ insertedId: stored._id });
  }

  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: { upsert?: boolean } = {},
  ) {
    if (this.beforeUpdateOne) {
      this.beforeUpdateOne(filter, update);
    }
    const existing = this.docs.find((d) => matchesFilter(d, filter));
    if (existing) {
      const modified = applyUpdate(existing, update);
      return Promise.resolve({
        matchedCount: 1,
        modifiedCount: modified ? 1 : 0,
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
    if (this.beforeBulkWrite) {
      this.beforeBulkWrite(ops);
    }
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

describe('M10.2.1 Ingestion Safety Hardening & Recovery', () => {
  describe('Strict database safety guard & CLI arg validation', () => {
    it('allows only explicitly approved local/test hosts and database gastro_core_test', () => {
      expect(() =>
        assertLocalIngestionTargetOnly(
          'mongodb://127.0.0.1:27017/gastro_core_test',
          'gastro_core_test',
        ),
      ).not.toThrow();

      expect(() =>
        assertLocalIngestionTargetOnly(
          'mongodb://gastro_core_svc:pass@mongo-test:27017/gastro_core_test?authSource=gastro_core_test',
          'gastro_core_test',
        ),
      ).not.toThrow();

      expect(
        resolveIngestionDatabaseConfig({
          MONGODB_URI_CORE:
            'mongodb://gastro_core_svc:pass@localhost:27017/gastro_core_test?authSource=gastro_core_test',
          CORE_DB_NAME: 'gastro_core_test',
        }),
      ).toMatchObject({
        dbName: 'gastro_core_test',
        redactedUri:
          'mongodb://gastro_core_svc:***@localhost:27017/gastro_core_test?authSource=gastro_core_test',
      });
    });

    it('fails closed on Atlas, remote hosts, non-test databases, mismatches, and malformed URIs', () => {
      const rejectedUris: Array<[string, string?]> = [
        ['', undefined],
        ['http://localhost:27017/gastro_core_test', undefined],
        [
          'mongodb+srv://user:pass@cluster0.xyz.mongodb.net/gastro_core_test',
          'gastro_core_test',
        ],
        [
          'mongodb://user:pass@cluster0.mongodb.net:27017/gastro_core_test',
          'gastro_core_test',
        ],
        [
          'mongodb://user:pass@prod-mongo:27017/gastro_core_test',
          'gastro_core_test',
        ],
        ['mongodb://localhost:27017/gastro_core', 'gastro_core'],
        ['mongodb://localhost:27017/gastrowise', undefined],
        ['mongodb://localhost:27017/gastro_core_test', 'gastro_core'],
        ['mongodb://localhost:27017/gastro_core', 'gastro_core_test'],
        ['mongodb://localhost:27017', 'gastro_core_test'],
        [
          'mongodb://localhost:27017/gastro_core_test?authSource=gastro_core',
          'gastro_core_test',
        ],
        [
          'mongodb://localhost:27017,mongo-test:27017/gastro_core_test',
          'gastro_core_test',
        ],
      ];

      for (const [uri, dbName] of rejectedUris) {
        expect(() => assertLocalIngestionTargetOnly(uri, dbName)).toThrow(
          IngestionValidationError,
        );
      }

      expect(() =>
        resolveIngestionDatabaseConfig({
          MONGODB_URI_CORE: 'mongodb://localhost:27017/gastro_core_test',
          CORE_DB_NAME: '',
        }),
      ).toThrow(IngestionValidationError);
    });

    it('defaults CLI to dry-run for import, rollback, and recover while blocking Atlas flags', () => {
      const dryRun = parseIngestionCliArgs(['--file=sample.json']);
      expect(dryRun.mode).toBe('dry-run');
      expect(dryRun.dryRun).toBe(true);

      const rollbackPreview = parseIngestionCliArgs(['--rollback=b1']);
      expect(rollbackPreview.mode).toBe('rollback');
      expect(rollbackPreview.dryRun).toBe(true);

      const recoverPreview = parseIngestionCliArgs([
        '--recover=b1',
        '--recover-action=compensate',
      ]);
      expect(recoverPreview.mode).toBe('recover');
      expect(recoverPreview.recoverAction).toBe('compensate');
      expect(recoverPreview.dryRun).toBe(true);

      expect(() =>
        parseIngestionCliArgs(['--file=sample.json', '--allow-atlas']),
      ).toThrow(IngestionValidationError);
      expect(() =>
        parseIngestionCliArgs([
          '--file=sample.json',
          '--uri=mongodb://localhost/gastro_core_test',
        ]),
      ).toThrow(IngestionValidationError);
    });
  });

  describe('Normalization & foodyReviewsCount provenance safety', () => {
    it('does not map native reviewsCount into foodyReviewsCount without explicit Foody provenance', () => {
      const withoutFoodyProvenance = validateAndNormalizeRestaurantRecord(
        {
          recordIndex: 0,
          payload: {
            RestaurantID: 123,
            externalSource: 'partner_import',
            Name: 'Quán Đối Tác',
            Latitude: 10.77,
            Longtitude: 106.7,
            reviewsCount: 45,
          },
        },
        'b1',
      );
      expect(
        withoutFoodyProvenance.candidate?.foodyReviewsCount,
      ).toBeUndefined();

      const withExplicitFoodyProvenance = validateAndNormalizeRestaurantRecord(
        {
          recordIndex: 1,
          payload: {
            RestaurantID: 124,
            Name: 'Quán Foody',
            Latitude: 10.77,
            Longtitude: 106.7,
            reviewsCount: 80,
            _reviewsCountIsFoodySource: true,
          },
        },
        'b1',
      );
      expect(withExplicitFoodyProvenance.candidate?.foodyReviewsCount).toBe(80);
    });

    it('normalizes staging SHA-256, 10-pt Foody scores, [0,0] GPS -> null, and ambiguous ratings', () => {
      const jsonl = `${JSON.stringify({ RestaurantID: 1, Name: 'Pho A' })}\n`;
      const parsed = parseRawIngestionInput(jsonl, 'jsonl');
      const sha = computeBatchChecksumSha256(jsonl);
      const staged = buildRawStagingDocuments(parsed, {
        batchId: 'batch_s1',
        checksumSha256: sha,
      });
      expect(staged[0].source).toBe(EXTERNAL_SOURCE_FOODY);
      expect(staged[0].batchChecksumSha256).toBe(sha);

      const foody10pt = validateAndNormalizeRestaurantRecord(
        {
          recordIndex: 0,
          payload: {
            RestaurantID: 1163155,
            Name: 'Phở Hùng',
            Address: '241 Nguyễn Trãi',
            Latitude: 10.766,
            Longtitude: 106.689,
            AvgRating: 8.4,
            TotalReview: 148,
            PriceMin: 55000,
            PriceMax: 95000,
            Cuisines: [{ Name: 'Món Việt' }],
            tags: ['mì phở', 'MÌ PHỞ, phở bò'],
          },
        },
        'batch_1',
      );
      expect(foody10pt.candidate?.diemTrungBinh).toBe(4.2);
      expect(foody10pt.candidate?.rawRating).toBe(8.4);
      expect(foody10pt.candidate?.ratingScale).toBe('10_point');
      expect(foody10pt.candidate?.foodyReviewsCount).toBe(148);
      expect(foody10pt.candidate?.tags).toBe('mì phở, phở bò, Món Việt');

      const ambiguous = validateAndNormalizeRestaurantRecord(
        {
          recordIndex: 1,
          payload: {
            RestaurantID: 3000,
            externalSource: 'partner_csv',
            Name: 'Ambiguous Cafe',
            AvgRating: 4.1,
            Latitude: 0,
            Longtitude: 0,
          },
        },
        'batch_1',
      );
      expect(ambiguous.candidate?.location).toBeNull();
      expect(ambiguous.candidate?.ratingScale).toBe('ambiguous');
    });
  });

  describe('Targeted deduplication, updated_count semantics & compare-and-set rollback', () => {
    const batch1Payload = JSON.stringify([
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
        ResUrlRewrite: 'pho-hoa-pasteur',
      },
      {
        RestaurantID: 202,
        Name: 'Bún Bò Huế',
        Address: '10 Lê Lợi, Quận 1',
        Latitude: 10.775,
        Longtitude: 106.701,
        AvgRating: 0.0,
      },
    ]);

    it('uses bounded targeted queries (never full-collection find({})), rejects reused batchIds, and separates matched vs modified counts', async () => {
      const existingId = new ObjectId();
      const fixedNow = new Date('2026-11-28T00:00:00Z');
      const { db, collections } = createInMemoryDb([
        {
          _id: existingId,
          externalSource: EXTERNAL_SOURCE_FOODY,
          externalSourceId: '101',
          tenQuan: 'Phở Hòa',
          diaChi: '260C Pasteur, Quận 3',
          giaCa: '55.000đ',
          reviewsCount: 5,
          diemTrungBinh: 4.9,
          ownerId: new ObjectId(),
          isVerified: true,
          isFeatured: true,
          createdAt: fixedNow,
        },
      ]);

      const res1 = await runRestaurantIngestionPipeline(db, {
        rawContent: batch1Payload,
        batchId: 'batch_cas_1',
        mode: 'apply',
        now: fixedNow,
      });

      // Verify zero unbounded {} queries executed against restaurants
      const restQueries = collections[RESTAURANTS_COLLECTION].findFilters;
      expect(restQueries.length).toBeGreaterThan(0);
      expect(restQueries.every((q) => Object.keys(q).length > 0)).toBe(true);

      expect(res1.metrics.inserted_count).toBe(1);
      expect(res1.metrics.matched_count).toBe(1);
      expect(res1.metrics.updated_count).toBe(1);

      // Reusing an already-applied batchId (with different or same checksum) MUST fail closed
      await expect(
        runRestaurantIngestionPipeline(db, {
          rawContent: JSON.stringify([
            {
              RestaurantID: 999,
              Name: 'Other',
              Latitude: 10.7,
              Longtitude: 106.7,
            },
          ]),
          batchId: 'batch_cas_1',
          mode: 'apply',
        }),
      ).rejects.toThrow(/Refusing to reuse batchId "batch_cas_1"/);

      // Verify matched_count vs updated_count when update is a no-op in bulkWrite
      const noopBulkSpy = jest
        .spyOn(collections[RESTAURANTS_COLLECTION], 'bulkWrite')
        .mockResolvedValueOnce({
          insertedCount: 0,
          matchedCount: 2,
          modifiedCount: 0,
          upsertedCount: 0,
        });
      const resNoop = await runRestaurantIngestionPipeline(db, {
        rawContent: batch1Payload,
        batchId: 'batch_cas_noop',
        mode: 'apply',
      });
      expect(resNoop.metrics.matched_count).toBe(2);
      expect(resNoop.metrics.updated_count).toBe(0);
      noopBulkSpy.mockRestore();
    });

    it('detects post-batch modifications, missing docs, user-owned mutations, enforces LIFO overlap order, and stays idempotent', async () => {
      const preExistingId = new ObjectId();
      const { db, collections } = createInMemoryDb([
        {
          _id: preExistingId,
          externalSource: EXTERNAL_SOURCE_FOODY,
          externalSourceId: '101',
          tenQuan: 'Phở Hòa',
          diaChi: '260C Pasteur, Quận 3',
          giaCa: '50.000đ',
          reviewsCount: 0,
          isVerified: false,
          isFeatured: false,
          createdAt: new Date('2025-01-01T00:00:00Z'),
        },
      ]);

      // Apply Batch 1, then overlapping Batch 2 updating the same docs
      await runRestaurantIngestionPipeline(db, {
        rawContent: batch1Payload,
        batchId: 'batch_overlap_1',
        mode: 'apply',
        now: new Date('2026-11-28T01:00:00Z'),
      });
      const batch2Payload = JSON.stringify([
        {
          RestaurantID: 101,
          Name: 'Phở Hòa - B2',
          Address: '260C Pasteur, Quận 3',
          Latitude: 10.783,
          Longtitude: 106.688,
          AvgRating: 8.8,
          PriceMin: 65000,
          PriceMax: 95000,
          ResUrlRewrite: 'pho-hoa-pasteur',
        },
        {
          RestaurantID: 202,
          Name: 'Bún Bò Huế - B2',
          Address: '10 Lê Lợi, Quận 1',
          Latitude: 10.775,
          Longtitude: 106.701,
          AvgRating: 8.0,
        },
      ]);
      await runRestaurantIngestionPipeline(db, {
        rawContent: batch2Payload,
        batchId: 'batch_overlap_2',
        mode: 'apply',
        now: new Date('2026-11-28T02:00:00Z'),
      });

      // Out-of-order rollback of Batch 1 MUST fail safely with OVERLAPPING_BATCH_CONFLICT and NOT overwrite Batch 2
      const outOfOrder = await rollbackIngestionBatch(db, 'batch_overlap_1', {
        dryRun: false,
      });
      expect(outOfOrder.status).toBe('conflict');
      expect(outOfOrder.deletedInsertedCount).toBe(0);
      expect(outOfOrder.restoredUpdatedCount).toBe(0);
      expect(outOfOrder.conflicts).toHaveLength(2);
      expect(
        outOfOrder.conflicts.every(
          (c) => c.reasonCode === 'OVERLAPPING_BATCH_CONFLICT',
        ),
      ).toBe(true);

      // Suppose a user modifies Record 202 AFTER Batch 2 while Record 101 stays unmodified
      const doc202 = collections[RESTAURANTS_COLLECTION].docs.find(
        (d) => d.externalSourceId === '202',
      );
      expect(doc202).toBeDefined();
      if (doc202) {
        doc202.isVerified = true;
        doc202.reviewsCount = 3;
      }

      // LIFO Rollback of Batch 2: restores unmodified 101, refuses overwrite on user-modified 202
      const rb2 = await rollbackIngestionBatch(db, 'batch_overlap_2', {
        dryRun: false,
      });
      expect(rb2.status).toBe('conflict');
      expect(rb2.restoredUpdatedCount).toBe(1);
      expect(rb2.conflicts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            docId: String(doc202?._id),
            reasonCode: 'USER_OWNED_MODIFIED',
          }),
        ]),
      );
      expect(doc202?.tenQuan).toBe('Bún Bò Huế - B2');

      // Delete doc 101 externally -> Batch 1 rollback handles MISSING document cleanly and skips user-modified 202 conflict
      await collections[RESTAURANTS_COLLECTION].deleteMany({
        _id: preExistingId,
      });
      const rb1WithMissing = await rollbackIngestionBatch(
        db,
        'batch_overlap_1',
        {
          dryRun: false,
        },
      );
      expect(rb1WithMissing.missingDocumentsCount).toBe(1);
      expect(rb1WithMissing.conflicts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            docId: String(preExistingId),
            reasonCode: 'DOCUMENT_MISSING',
          }),
        ]),
      );

      // Normal rollback on clean batch -> idempotent repeated rollback
      const cleanBatchPayload = JSON.stringify([
        {
          RestaurantID: 555,
          Name: 'Quán Clean Rollback',
          Address: '5 Lý Tự Trọng',
          Latitude: 10.779,
          Longtitude: 106.704,
          AvgRating: 8.2,
        },
      ]);
      await runRestaurantIngestionPipeline(db, {
        rawContent: cleanBatchPayload,
        batchId: 'batch_clean_idemp',
        mode: 'apply',
      });
      const cleanFirst = await rollbackIngestionBatch(db, 'batch_clean_idemp', {
        dryRun: false,
      });
      expect(cleanFirst.status).toBe('rolled_back');
      expect(cleanFirst.deletedInsertedCount).toBe(1);

      const cleanRepeat = await rollbackIngestionBatch(
        db,
        'batch_clean_idemp',
        { dryRun: false },
      );
      expect(cleanRepeat.status).toBe('already_rolled_back');
      expect(cleanRepeat.deletedInsertedCount).toBe(0);
    });
  });

  describe('Write-ahead pending batch ledger & crash recovery fault injection', () => {
    const rawOneDoc = JSON.stringify([
      {
        RestaurantID: 777,
        Name: 'Quán Recovery Test',
        Address: '77 Nguyễn Huệ, Q1',
        Latitude: 10.774,
        Longtitude: 106.703,
        AvgRating: 8.5,
      },
    ]);

    it('transitions to failed when staging fails before restaurant mutation and recovers safely', async () => {
      const { db, collections } = createInMemoryDb();

      collections[RAW_STAGING_COLLECTION].beforeBulkWrite = () => {
        throw new Error('Injected staging disk/write failure');
      };

      await expect(
        runRestaurantIngestionPipeline(db, {
          rawContent: rawOneDoc,
          batchId: 'batch_fail_staging',
          mode: 'apply',
        }),
      ).rejects.toThrow(/Injected staging disk\/write failure/);

      const ledger = await collections[INGESTION_BATCHES_COLLECTION].findOne({
        _id: 'batch_fail_staging',
      });
      expect(ledger?.status).toBe('failed');
      expect(ledger?.failureStage).toBe('staging');
      expect(collections[RESTAURANTS_COLLECTION].docs).toHaveLength(0);

      const rec = await recoverIngestionBatch(db, 'batch_fail_staging', {
        dryRun: false,
      });
      expect(rec.finalStatus).toBe('failed');
      expect(rec.actionTaken).toBe('marked_failed_no_writes');
      expect(rec.standaloneLimitationNote).toBe(
        STANDALONE_MONGODB_LIMITATION_NOTE,
      );
    });

    it('marks recovery_required on partial restaurant writes and compensates cleanly', async () => {
      const twoDocs = JSON.stringify([
        {
          RestaurantID: 801,
          Name: 'Quán Partial 1',
          Address: '1 Lê Lợi',
          Latitude: 10.774,
          Longtitude: 106.701,
          AvgRating: 8.0,
        },
        {
          RestaurantID: 802,
          Name: 'Quán Partial 2',
          Address: '2 Lê Lợi',
          Latitude: 10.775,
          Longtitude: 106.702,
          AvgRating: 8.2,
        },
      ]);

      const { db, collections } = createInMemoryDb();
      let insertsSeen = 0;
      collections[RESTAURANTS_COLLECTION].beforeInsertOne = () => {
        insertsSeen += 1;
        if (insertsSeen === 2) {
          throw new Error('Injected partial write crash on 2nd doc');
        }
      };

      await expect(
        runRestaurantIngestionPipeline(db, {
          rawContent: twoDocs,
          batchId: 'batch_partial_crash',
          mode: 'apply',
        }),
      ).rejects.toThrow(/Injected partial write crash/);

      collections[RESTAURANTS_COLLECTION].beforeInsertOne = undefined;

      const ledger = await collections[INGESTION_BATCHES_COLLECTION].findOne({
        _id: 'batch_partial_crash',
      });
      expect(ledger?.status).toBe('recovery_required');
      expect(ledger?.failureStage).toBe('restaurant_write');
      expect(collections[RESTAURANTS_COLLECTION].docs).toHaveLength(1);

      const rec = await recoverIngestionBatch(db, 'batch_partial_crash', {
        action: 'auto',
        dryRun: false,
      });
      expect(rec.actionTaken).toBe('compensated_partial_writes');
      expect(rec.finalStatus).toBe('rolled_back');
      expect(rec.deletedInsertedCount).toBe(1);
      expect(collections[RESTAURANTS_COLLECTION].docs).toHaveLength(0);
    });

    it('recovers when restaurant writes succeed but ledger finalize update fails', async () => {
      const { db, collections } = createInMemoryDb();

      collections[INGESTION_BATCHES_COLLECTION].beforeUpdateOne = (filter) => {
        if (filter.status === 'pending') {
          throw new Error('Injected ledger finalize crash');
        }
      };

      await expect(
        runRestaurantIngestionPipeline(db, {
          rawContent: rawOneDoc,
          batchId: 'batch_finalize_crash',
          mode: 'apply',
        }),
      ).rejects.toThrow(/Injected ledger finalize crash/);

      collections[INGESTION_BATCHES_COLLECTION].beforeUpdateOne = undefined;

      // Verify restaurant write landed and ledger remained pending (or recovery_required)
      expect(collections[RESTAURANTS_COLLECTION].docs).toHaveLength(1);
      const pendingLedger = await collections[
        INGESTION_BATCHES_COLLECTION
      ].findOne({ _id: 'batch_finalize_crash' });
      expect(['pending', 'recovery_required']).toContain(pendingLedger?.status);

      // Normal rollback MUST refuse an unrecovered batch
      await expect(
        rollbackIngestionBatch(db, 'batch_finalize_crash'),
      ).rejects.toThrow(/Run recoverIngestionBatch/);

      // Recover completes pending apply cleanly without duplicate writes
      const rec = await recoverIngestionBatch(db, 'batch_finalize_crash', {
        action: 'auto',
        dryRun: false,
      });
      expect(rec.actionTaken).toBe('completed_pending_apply');
      expect(rec.finalStatus).toBe('applied');
      expect(rec.landedInsertedCount).toBe(1);

      // Now normal rollback works cleanly
      const rb = await rollbackIngestionBatch(db, 'batch_finalize_crash', {
        dryRun: false,
      });
      expect(rb.status).toBe('rolled_back');
      expect(rb.deletedInsertedCount).toBe(1);
      expect(collections[RESTAURANTS_COLLECTION].docs).toHaveLength(0);
    });

    it('recovers directly from stuck pending status if both finalize and best-effort error update fail', async () => {
      const { db, collections } = createInMemoryDb();

      collections[INGESTION_BATCHES_COLLECTION].beforeUpdateOne = () => {
        throw new Error('Injected total ledger write outage after pending');
      };

      await expect(
        runRestaurantIngestionPipeline(db, {
          rawContent: rawOneDoc,
          batchId: 'batch_stuck_pending',
          mode: 'apply',
        }),
      ).rejects.toThrow(/Injected total ledger write outage/);

      collections[INGESTION_BATCHES_COLLECTION].beforeUpdateOne = undefined;

      const stuck = await collections[INGESTION_BATCHES_COLLECTION].findOne({
        _id: 'batch_stuck_pending',
      });
      expect(stuck?.status).toBe('pending');
      expect(collections[RESTAURANTS_COLLECTION].docs).toHaveLength(1);

      const rec = await recoverIngestionBatch(db, 'batch_stuck_pending', {
        action: 'auto',
        dryRun: false,
      });
      expect(rec.previousStatus).toBe('pending');
      expect(rec.finalStatus).toBe('applied');
      expect(rec.actionTaken).toBe('completed_pending_apply');
    });
  });
});
