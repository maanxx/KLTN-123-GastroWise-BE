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
  RAW_STAGING_COLLECTION,
  RESTAURANTS_COLLECTION,
} from './ingestion.types';
import { MENU_ITEMS_COLLECTION } from './dish-ingestion.normalizer';

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

  find(filter: Doc = {}) {
    const matched = this.docs.filter((d) => matchesFilter(d, filter));
    return {
      project: () => ({
        toArray: () => Promise.resolve(matched.map((d) => ({ ...d }))),
      }),
      toArray: () => Promise.resolve(matched.map((d) => ({ ...d }))),
    };
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
  });
});
