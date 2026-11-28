import * as fs from 'fs';
import * as path from 'path';
import { ObjectId } from 'mongodb';
import type { AnyBulkWriteOperation, Db } from 'mongodb';
import {
  extractFoodDatasetRecords,
  normalizeDishImageUrl,
  parseDishPriceVnd,
  validateAndNormalizeDishRecord,
} from './dish-ingestion.normalizer';
import { runLocalFoodDatasetIngestionPipeline } from './food-dataset.pipeline';
import {
  EXTERNAL_SOURCE_FOODY,
  INGESTION_BATCHES_COLLECTION,
  IngestionValidationError,
  RAW_STAGING_COLLECTION,
  RESTAURANTS_COLLECTION,
} from './ingestion.types';
import { assertLocalIngestionTargetOnly } from './ingestion.connection';
import {
  preflightDishExternalSourceUniqueIndex,
  rolloutDishIngestionIndexes,
  UNIQUE_DISH_EXTERNAL_SOURCE_INDEX_NAME,
} from './ingestion.index-preflight';
import { MENU_ITEMS_COLLECTION } from './dish-ingestion.normalizer';
import { MenuItemSchema } from '../../../../apps/core-service/src/restaurants/schemas/menu-item.schema';
import { parseFoodDatasetCliArgs } from '../../../../scripts/ingestion/ingest-food-dataset';

type Doc = Record<string, unknown>;

function matchesFilter(doc: Doc, filter: Doc): boolean {
  for (const [key, cond] of Object.entries(filter)) {
    if (key === '$or' && Array.isArray(cond)) {
      if (!cond.some((sub) => matchesFilter(doc, sub as Doc))) return false;
      continue;
    }
    if (key === '$and' && Array.isArray(cond)) {
      if (!cond.every((sub) => matchesFilter(doc, sub as Doc))) return false;
      continue;
    }
    const val = doc[key];
    if (cond instanceof ObjectId) {
      if (!(val instanceof ObjectId) || !val.equals(cond)) return false;
      continue;
    }
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      const op = cond as Doc;
      if ('$in' in op && Array.isArray(op.$in)) {
        const matched = op.$in.some((item) =>
          item instanceof ObjectId && val instanceof ObjectId
            ? item.equals(val)
            : item === val,
        );
        if (!matched) return false;
        continue;
      }
      if ('$ne' in op && val === op.$ne) return false;
      if ('$exists' in op && Boolean(val !== undefined) !== op.$exists) {
        return false;
      }
      continue;
    }
    if (val !== cond) return false;
  }
  return true;
}

class InMemoryCollection {
  public docs: Doc[] = [];
  public createdIndexes: Array<{ spec: Doc; options?: Doc }> = [];

  find(filter: Doc = {}) {
    const matched = this.docs.filter((d) => matchesFilter(d, filter));
    return {
      project: () => ({
        toArray: () => Promise.resolve(matched.map((d) => ({ ...d }))),
      }),
      toArray: () => Promise.resolve(matched.map((d) => ({ ...d }))),
    };
  }

  aggregate() {
    // Evaluates duplicate (externalSource, externalSourceId) string groups for index preflight tests
    const groups = new Map<
      string,
      {
        externalSource: string;
        externalSourceId: string;
        count: number;
        docIds: unknown[];
        names: string[];
      }
    >();
    for (const d of this.docs) {
      if (
        typeof d.externalSource === 'string' &&
        typeof d.externalSourceId === 'string'
      ) {
        const key = `${d.externalSource}::${d.externalSourceId}`;
        const existing = groups.get(key) || {
          externalSource: d.externalSource,
          externalSourceId: d.externalSourceId,
          count: 0,
          docIds: [],
          names: [],
        };
        existing.count += 1;
        existing.docIds.push(d._id);
        existing.names.push(typeof d.name === 'string' ? d.name : '');
        groups.set(key, existing);
      }
    }
    const dupGroups = Array.from(groups.values())
      .filter((g) => g.count > 1)
      .map((g) => ({
        _id: {
          externalSource: g.externalSource,
          externalSourceId: g.externalSourceId,
        },
        count: g.count,
        docIds: g.docIds,
        names: g.names,
      }));
    const summary =
      dupGroups.length > 0
        ? [
            {
              totalDuplicateGroups: dupGroups.length,
              totalAffectedDocuments: dupGroups.reduce(
                (acc, g) => acc + g.count,
                0,
              ),
            },
          ]
        : [];
    return {
      toArray: () => Promise.resolve([{ summary, sampleGroups: dupGroups }]),
    };
  }

  createIndex(spec: Doc, options?: Doc) {
    this.createdIndexes.push({ spec, options });
    return Promise.resolve(
      typeof options?.name === 'string' ? options.name : 'idx',
    );
  }

  findOne(filter: Doc = {}) {
    const found = this.docs.find((d) => matchesFilter(d, filter));
    return Promise.resolve(found ? { ...found } : null);
  }

  insertOne(doc: Doc) {
    const stored = { _id: doc._id ?? new ObjectId(), ...doc };
    this.docs.push(stored);
    return Promise.resolve({ insertedId: stored._id });
  }

  insertMany(docs: Doc[]) {
    const insertedIds: Record<number, unknown> = {};
    docs.forEach((doc, idx) => {
      const stored = { _id: doc._id ?? new ObjectId(), ...doc };
      this.docs.push(stored);
      insertedIds[idx] = stored._id;
    });
    return Promise.resolve({
      insertedCount: docs.length,
      insertedIds,
    });
  }

  updateOne(
    filter: Doc,
    update: { $set?: Doc; $setOnInsert?: Doc; $unset?: Doc },
    options?: { upsert?: boolean },
  ) {
    const idx = this.docs.findIndex((d) => matchesFilter(d, filter));
    if (idx !== -1) {
      const next = { ...this.docs[idx], ...(update.$set || {}) };
      if (update.$unset) {
        for (const k of Object.keys(update.$unset)) {
          delete next[k];
        }
      }
      this.docs[idx] = next;
      return Promise.resolve({ matchedCount: 1, modifiedCount: 1 });
    }
    if (options?.upsert) {
      const created: Doc = {
        _id: new ObjectId(),
        ...filter,
        ...(update.$setOnInsert || {}),
        ...(update.$set || {}),
      };
      this.docs.push(created);
      return Promise.resolve({
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 1,
        upsertedId: created._id,
      });
    }
    return Promise.resolve({ matchedCount: 0, modifiedCount: 0 });
  }

  async bulkWrite(ops: AnyBulkWriteOperation[]) {
    let insertedCount = 0;
    let modifiedCount = 0;
    let upsertedCount = 0;
    for (const op of ops) {
      if ('updateOne' in op && op.updateOne) {
        const res = await this.updateOne(
          op.updateOne.filter as Doc,
          op.updateOne.update as { $set?: Doc; $setOnInsert?: Doc },
          { upsert: op.updateOne.upsert },
        );
        if (res.upsertedCount) upsertedCount += 1;
        else if (res.modifiedCount) modifiedCount += 1;
      } else if ('insertOne' in op && op.insertOne) {
        await this.insertOne(op.insertOne.document as Doc);
        insertedCount += 1;
      }
    }
    return { insertedCount, modifiedCount, upsertedCount };
  }

  countDocuments(filter: Doc = {}) {
    return Promise.resolve(
      this.docs.filter((d) => matchesFilter(d, filter)).length,
    );
  }
}

function createMockDb() {
  const collections = new Map<string, InMemoryCollection>([
    [RESTAURANTS_COLLECTION, new InMemoryCollection()],
    [MENU_ITEMS_COLLECTION, new InMemoryCollection()],
    [RAW_STAGING_COLLECTION, new InMemoryCollection()],
    [INGESTION_BATCHES_COLLECTION, new InMemoryCollection()],
  ]);

  const db = {
    collection: (name: string) => {
      if (!collections.has(name)) {
        collections.set(name, new InMemoryCollection());
      }
      return collections.get(name)!;
    },
  } as unknown as Db;

  return { db, collections };
}

describe('M10.7 Local Food Dataset & Ingestion Pipeline', () => {
  describe('Dish normalization & validation', () => {
    it('normalizes Vietnamese formatted prices, numeric prices, shorthand k prices, and rejects invalid prices', () => {
      expect(parseDishPriceVnd(75000)).toBe(75000);
      expect(parseDishPriceVnd('75.000đ')).toBe(75000);
      expect(parseDishPriceVnd('68,000 VND')).toBe(68000);
      expect(parseDishPriceVnd('45k')).toBe(45000);
      expect(parseDishPriceVnd('45.5k')).toBe(45500);
      expect(parseDishPriceVnd({ value: 52000 })).toBe(52000);
      expect(parseDishPriceVnd(0)).toBe(0);

      expect(parseDishPriceVnd(-1000)).toBeNull();
      expect(parseDishPriceVnd('-50.000đ')).toBeNull();
      expect(parseDishPriceVnd('free')).toBeNull();
      expect(parseDishPriceVnd(999_999_999)).toBeNull();
      expect(parseDishPriceVnd(null)).toBeNull();
    });

    it('validates image URLs and rejects unsafe or credential-bearing URLs', () => {
      expect(
        normalizeDishImageUrl('https://images.unsplash.com/pho.jpg'),
      ).toEqual({
        valid: true,
        url: 'https://images.unsplash.com/pho.jpg',
      });
      expect(normalizeDishImageUrl(undefined)).toEqual({
        valid: true,
        url: '',
      });
      expect(normalizeDishImageUrl('javascript:alert(1)').valid).toBe(false);
      expect(
        normalizeDishImageUrl('https://user:secret@example.com/a.jpg').valid,
      ).toBe(false);
      expect(normalizeDishImageUrl('not-a-url').valid).toBe(false);
    });

    it('normalizes valid dish records and rejects missing required fields with structured errors', () => {
      const ok = validateAndNormalizeDishRecord(
        {
          recordIndex: 0,
          payload: {
            dishId: 'd-1',
            restaurantExternalId: 'r-1',
            name: '  Phở   Tái  ',
            description: '  Nước dùng bò  ',
            price: '75.000đ',
            category: 'Món chính',
            tags: ['Phở', 'món chính'],
            isVegetarian: 'false',
            calories: 510,
          },
        },
        'batch-1',
        EXTERNAL_SOURCE_FOODY,
      );
      expect(ok.valid).toBe(true);
      expect(ok.candidate).toMatchObject({
        externalSource: EXTERNAL_SOURCE_FOODY,
        externalSourceId: 'd-1',
        restaurantExternalId: 'r-1',
        name: 'Phở Tái',
        description: 'Nước dùng bò',
        price: 75000,
        tags: ['Phở', 'món chính'],
        isVegetarian: false,
        calories: 510,
      });

      const bad = validateAndNormalizeDishRecord(
        {
          recordIndex: 1,
          payload: {
            dishId: '',
            name: '',
            price: -50,
            imageUrl: 'ftp://bad-proto.example/img.jpg',
          },
        },
        'batch-1',
      );
      expect(bad.valid).toBe(false);
      const fields = bad.errors.map((e) => e.field);
      expect(fields).toEqual(
        expect.arrayContaining([
          'externalSourceId',
          'restaurantExternalId',
          'name',
          'price',
          'image',
        ]),
      );
    });

    it('extracts both standalone and nested dishes from sample ShopeeFood dataset', () => {
      const fixturePath = path.resolve(
        __dirname,
        '../../../../scripts/ingestion/fixtures/sample_shopeefood_food_dataset.json',
      );
      const raw = fs.readFileSync(fixturePath, 'utf8');
      const extracted = extractFoodDatasetRecords(raw);
      expect(extracted.restaurants).toHaveLength(5);
      expect(extracted.dishes).toHaveLength(10);
    });
  });

  describe('End-to-end local pipeline: partial failures, relationships, and idempotent repeats', () => {
    it('imports valid restaurants and dishes from fixture, isolates invalid/orphan/duplicate records, and is idempotent on repeat', async () => {
      const fixturePath = path.resolve(
        __dirname,
        '../../../../scripts/ingestion/fixtures/sample_shopeefood_food_dataset.json',
      );
      const rawContent = fs.readFileSync(fixturePath, 'utf8');
      const { db, collections } = createMockDb();

      // 1. Dry-run preview must not persist anything
      const dryRun = await runLocalFoodDatasetIngestionPipeline(db, {
        rawContent,
        source: 'shopeefood',
        batchId: 'm107-dry-1',
        mode: 'dry-run',
      });
      expect(dryRun.mode).toBe('dry-run');
      expect(dryRun.restaurants.valid).toBe(3);
      expect(dryRun.restaurants.rejected).toBe(1);
      expect(dryRun.dishes.valid).toBe(6);
      expect(dryRun.dishes.rejected).toBe(3);
      expect(collections.get(RESTAURANTS_COLLECTION)!.docs).toHaveLength(0);
      expect(collections.get(MENU_ITEMS_COLLECTION)!.docs).toHaveLength(0);

      // 2. First apply run persists 3 restaurants and 6 dishes, rejects invalid/orphan records without corrupting valid ones
      const firstRun = await runLocalFoodDatasetIngestionPipeline(db, {
        rawContent,
        source: 'shopeefood',
        batchId: 'm107-apply-1',
        mode: 'apply',
      });

      expect(firstRun.totalRecordsReceived).toBe(15);
      expect(firstRun.validRecords).toBe(9);
      expect(firstRun.rejectedRecords).toBe(4);
      expect(firstRun.insertedRecords).toBe(9);
      expect(firstRun.updatedRecords).toBe(0);
      expect(firstRun.skippedDuplicates).toBe(2);
      expect(firstRun.restaurants).toEqual({
        totalReceived: 5,
        valid: 3,
        rejected: 1,
        inserted: 3,
        updated: 0,
        skippedDuplicates: 1,
      });
      expect(firstRun.dishes).toEqual({
        totalReceived: 10,
        valid: 6,
        rejected: 3,
        inserted: 6,
        updated: 0,
        skippedDuplicates: 1,
      });
      expect(firstRun.validationErrorsByField).toEqual({
        'restaurant.Name': 1,
        'dish.price': 1,
        'dish.name': 1,
        'dish.restaurantExternalId': 1,
      });
      expect(firstRun.durationMs).toBeGreaterThanOrEqual(0);
      expect(collections.get(RESTAURANTS_COLLECTION)!.docs).toHaveLength(3);
      expect(collections.get(MENU_ITEMS_COLLECTION)!.docs).toHaveLength(6);

      // Every persisted dish must link to an actual persisted restaurant ObjectId
      const restIds = new Set(
        collections
          .get(RESTAURANTS_COLLECTION)!
          .docs.map((d) => (d._id as ObjectId).toHexString()),
      );
      for (const dishDoc of collections.get(MENU_ITEMS_COLLECTION)!.docs) {
        expect(dishDoc.restaurantId).toBeInstanceOf(ObjectId);
        expect(
          restIds.has((dishDoc.restaurantId as ObjectId).toHexString()),
        ).toBe(true);
      }

      // 3. Repeated apply run must be idempotent: 0 new inserts, 0 duplicates created in DB
      const secondRun = await runLocalFoodDatasetIngestionPipeline(db, {
        rawContent,
        source: 'shopeefood',
        batchId: 'm107-apply-2',
        mode: 'apply',
      });
      expect(secondRun.dishes.inserted).toBe(0);
      expect(secondRun.dishes.updated).toBe(0);
      expect(secondRun.dishes.skippedDuplicates).toBe(7); // 1 intra-batch + 6 unchanged existing
      expect(secondRun.restaurants.inserted).toBe(0);
      expect(collections.get(RESTAURANTS_COLLECTION)!.docs).toHaveLength(3);
      expect(collections.get(MENU_ITEMS_COLLECTION)!.docs).toHaveLength(6);
    });

    it('handles invalid restaurant coordinates safely without crashing valid dish imports', async () => {
      const dataset = JSON.stringify({
        restaurants: [
          {
            RestaurantID: 777001,
            Name: 'Quán Null Island Test',
            Address: '123 Test Street, Quận 1',
            Latitude: 0,
            Longtitude: 0,
            AvgRating: 8.2,
          },
        ],
        dishes: [
          {
            dishId: 'dish-777001-1',
            restaurantExternalId: '777001',
            name: 'Bún Chả',
            price: '55.000đ',
          },
        ],
      });

      const { db, collections } = createMockDb();
      const result = await runLocalFoodDatasetIngestionPipeline(db, {
        rawContent: dataset,
        source: 'shopeefood',
        batchId: 'm107-coords-1',
        mode: 'apply',
      });

      expect(result.restaurants.inserted).toBe(1);
      expect(result.dishes.inserted).toBe(1);
      const restDoc = collections.get(RESTAURANTS_COLLECTION)!.docs[0];
      expect(restDoc.location).toBeNull();
    });

    it('persists sanitized, bounded sourceMetadata on menu_items and strips credentials/tokens before storage', async () => {
      const dataset = JSON.stringify({
        restaurants: [
          {
            RestaurantID: 888001,
            Name: 'Quán Metadata Test',
            Address: '45 Lê Lợi, Quận 1',
            Latitude: 10.774,
            Longtitude: 106.701,
            AvgRating: 8.5,
          },
        ],
        dishes: [
          {
            dishId: 'dish-meta-1',
            restaurantExternalId: '888001',
            name: 'Bún Bò Huế',
            price: '65.000đ',
            sourceMetadata: {
              crawlBatch: 'sf-2026-11',
              originalCategoryId: 42,
              apiKey: 'super-secret-key',
              authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9',
              sourceUrl:
                'https://user:mySecretPass@partner.example/api?token=leak123&page=1',
            },
          },
        ],
      });

      const { db, collections } = createMockDb();
      const result = await runLocalFoodDatasetIngestionPipeline(db, {
        rawContent: dataset,
        source: 'shopeefood',
        batchId: 'm107-meta-1',
        mode: 'apply',
      });

      expect(result.dishes.inserted).toBe(1);
      const dishDoc = collections.get(MENU_ITEMS_COLLECTION)!.docs[0];
      const storedMeta = dishDoc.sourceMetadata as Record<string, unknown>;
      expect(storedMeta).toBeDefined();
      expect(storedMeta.crawlBatch).toBe('sf-2026-11');
      expect(storedMeta.originalCategoryId).toBe(42);
      expect(storedMeta.apiKey).toBeUndefined();
      expect(storedMeta.authorization).toBeUndefined();
      const serializedMeta = JSON.stringify(storedMeta);
      expect(serializedMeta).not.toContain('super-secret-key');
      expect(serializedMeta).not.toContain('mySecretPass');
      expect(serializedMeta).not.toContain('leak123');
      expect(serializedMeta).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    });

    it('enforces local-only gastro_core_test DB target and --apply write guard', () => {
      // Blocks Atlas SRV, remote hosts, and production/planning databases
      expect(() =>
        assertLocalIngestionTargetOnly(
          'mongodb+srv://user:pass@cluster0.mongodb.net/gastro_core_test',
          'gastro_core_test',
        ),
      ).toThrow(IngestionValidationError);
      expect(() =>
        assertLocalIngestionTargetOnly(
          'mongodb://db.example.com:27017/gastro_core_test',
          'gastro_core_test',
        ),
      ).toThrow(IngestionValidationError);
      expect(() =>
        assertLocalIngestionTargetOnly(
          'mongodb://127.0.0.1:27017/gastro_core',
          'gastro_core',
        ),
      ).toThrow(IngestionValidationError);
      expect(() =>
        assertLocalIngestionTargetOnly(
          'mongodb://127.0.0.1:27017/gastro_planning_test',
          'gastro_planning_test',
        ),
      ).toThrow(IngestionValidationError);
      expect(
        assertLocalIngestionTargetOnly(
          'mongodb://gastro_core_svc:pass@mongo-test:27017/gastro_core_test?authSource=gastro_core_test',
          'gastro_core_test',
        ),
      ).toEqual({ host: 'mongo-test', dbName: 'gastro_core_test' });

      // CLI --apply requires GASTROWISE_ALLOW_LOCAL_INGESTION=true; --dry-run does not
      expect(() =>
        parseFoodDatasetCliArgs(['--file=sample.json', '--apply'], {}),
      ).toThrow(IngestionValidationError);
      expect(
        parseFoodDatasetCliArgs(['--file=sample.json', '--dry-run'], {}).mode,
      ).toBe('dry-run');
      expect(
        parseFoodDatasetCliArgs(['--file=sample.json', '--apply'], {
          GASTROWISE_ALLOW_LOCAL_INGESTION: 'true',
        }).mode,
      ).toBe('apply');
      expect(() =>
        parseFoodDatasetCliArgs(['--ensure-indexes', '--apply'], {}),
      ).toThrow(IngestionValidationError);
      expect(parseFoodDatasetCliArgs(['--preflight-indexes'], {}).mode).toBe(
        'preflight-indexes',
      );
    });
  });

  describe('Database-level partial unique dish index, concurrency & legacy compatibility', () => {
    it('declares unique: true partial index on MenuItemSchema for string externalSource + externalSourceId', () => {
      const schemaIndexes = MenuItemSchema.indexes();
      const uniqueDishIdx = schemaIndexes.find(
        ([spec]) => spec.externalSource === 1 && spec.externalSourceId === 1,
      );
      expect(uniqueDishIdx).toBeDefined();
      expect(uniqueDishIdx?.[1]).toMatchObject({
        name: UNIQUE_DISH_EXTERNAL_SOURCE_INDEX_NAME,
        unique: true,
        partialFilterExpression: {
          externalSource: { $type: 'string' },
          externalSourceId: { $type: 'string' },
        },
      });
    });

    it('allows different sources with the same externalSourceId and preserves legacy menu items without provenance', async () => {
      const { db, collections } = createMockDb();
      const restId = new ObjectId();
      const restaurantsCol = collections.get(RESTAURANTS_COLLECTION)!;
      const menuCol = collections.get(MENU_ITEMS_COLLECTION)!;

      // Seed 2 legacy menu items WITHOUT externalSource / externalSourceId
      await menuCol.insertMany([
        { restaurantId: restId, name: 'Legacy Phở 1', price: 60000 },
        { restaurantId: restId, name: 'Legacy Phở 2', price: 65000 },
      ]);
      // Seed 2 restaurants under different sources sharing externalSourceId "shared-100"
      await restaurantsCol.insertMany([
        {
          _id: restId,
          tenQuan: 'Quán Multi-Source',
          externalSource: 'shopeefood',
          externalSourceId: 'shared-100',
        },
        {
          _id: new ObjectId(),
          tenQuan: 'Quán Multi-Source Foody',
          externalSource: 'foody',
          externalSourceId: 'shared-100',
        },
      ]);

      // Import same dishId "dish-shared-1" from two distinct sources
      await runLocalFoodDatasetIngestionPipeline(db, {
        rawContent: JSON.stringify({
          dishes: [
            {
              dishId: 'dish-shared-1',
              restaurantExternalId: 'shared-100',
              name: 'Phở ShopeeFood',
              price: 70000,
            },
          ],
        }),
        source: 'shopeefood',
        batchId: 'multi-src-1',
        mode: 'apply',
      });
      await runLocalFoodDatasetIngestionPipeline(db, {
        rawContent: JSON.stringify({
          dishes: [
            {
              dishId: 'dish-shared-1',
              restaurantExternalId: 'shared-100',
              name: 'Phở Foody',
              price: 72000,
            },
          ],
        }),
        source: 'foody',
        batchId: 'multi-src-2',
        mode: 'apply',
      });

      // 2 legacy items + 2 distinct-source dishes = 4 total, 0 duplicates
      expect(menuCol.docs).toHaveLength(4);
      const preflight = await preflightDishExternalSourceUniqueIndex(db);
      expect(preflight.safeToCreateUniqueIndex).toBe(true);
      expect(preflight.duplicateGroupCount).toBe(0);
    });

    it('handles concurrent upsert attempts (including E11000 unique-index race) without creating duplicate dishes', async () => {
      const { db, collections } = createMockDb();
      const restId = new ObjectId();
      await collections.get(RESTAURANTS_COLLECTION)!.insertOne({
        _id: restId,
        tenQuan: 'Quán Concurrent',
        externalSource: 'shopeefood',
        externalSourceId: 'conc-rest-1',
      });

      const menuCol = collections.get(MENU_ITEMS_COLLECTION)!;
      const origBulkWrite = menuCol.bulkWrite.bind(menuCol) as (
        ops: AnyBulkWriteOperation[],
      ) => Promise<{
        insertedCount: number;
        modifiedCount: number;
        upsertedCount: number;
      }>;
      let firstRaceTriggered = false;
      jest.spyOn(menuCol, 'bulkWrite').mockImplementation(async (ops) => {
        if (!firstRaceTriggered) {
          firstRaceTriggered = true;
          // Simulate concurrent insert winning first, then raising MongoDB E11000
          await origBulkWrite(ops);
          const dupErr = Object.assign(
            new Error('E11000 duplicate key error'),
            {
              code: 11000,
            },
          );
          throw dupErr;
        }
        return origBulkWrite(ops);
      });

      const dataset = JSON.stringify({
        dishes: [
          {
            dishId: 'conc-dish-1',
            restaurantExternalId: 'conc-rest-1',
            name: 'Cơm Gà',
            price: 55000,
          },
        ],
      });

      await Promise.all([
        runLocalFoodDatasetIngestionPipeline(db, {
          rawContent: dataset,
          source: 'shopeefood',
          batchId: 'conc-1',
          mode: 'apply',
        }),
        runLocalFoodDatasetIngestionPipeline(db, {
          rawContent: dataset,
          source: 'shopeefood',
          batchId: 'conc-2',
          mode: 'apply',
        }),
      ]);

      expect(menuCol.docs).toHaveLength(1);
      expect(menuCol.docs[0].externalSourceId).toBe('conc-dish-1');
    });

    it('detects existing duplicate dish records non-destructively and blocks unique index creation', async () => {
      const { db, collections } = createMockDb();
      const restId = new ObjectId();
      const menuCol = collections.get(MENU_ITEMS_COLLECTION)!;

      // Seed 2 existing duplicate dishes with identical (externalSource, externalSourceId)
      await menuCol.insertMany([
        {
          restaurantId: restId,
          name: 'Phở Trùng 1',
          price: 60000,
          externalSource: 'shopeefood',
          externalSourceId: 'dup-dish-99',
        },
        {
          restaurantId: restId,
          name: 'Phở Trùng 2',
          price: 65000,
          externalSource: 'shopeefood',
          externalSourceId: 'dup-dish-99',
        },
      ]);

      const report = await preflightDishExternalSourceUniqueIndex(db);
      expect(report.safeToCreateUniqueIndex).toBe(false);
      expect(report.duplicateGroupCount).toBe(1);
      expect(report.totalAffectedDocuments).toBe(2);
      expect(report.duplicates[0].externalSourceId).toBe('dup-dish-99');
      expect(report.remediationSteps.length).toBeGreaterThan(0);

      // rolloutDishIngestionIndexes must refuse index creation and NEVER delete existing records
      await expect(
        rolloutDishIngestionIndexes(db, { dryRun: false }),
      ).rejects.toThrow(IngestionValidationError);
      expect(menuCol.docs).toHaveLength(2);
      expect(menuCol.createdIndexes).toHaveLength(0);
    });
  });
});
