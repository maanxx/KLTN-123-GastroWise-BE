import { ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import { RestaurantSchema } from '../../../../apps/core-service/src/restaurants/schemas/restaurant.schema';
import {
  assertLocalIngestionTargetOnly,
  backfillLegacyNormalizedKeys,
  buildRawStagingDocuments,
  computeBatchChecksumSha256,
  EXTERNAL_SOURCE_FOODY,
  INGESTION_BATCHES_COLLECTION,
  IngestionValidationError,
  MAX_DUPLICATE_GROUP_SAMPLES,
  MAX_SAMPLE_DOCS_PER_GROUP,
  parseIngestionCliArgs,
  parseRawIngestionInput,
  preflightExternalSourceUniqueIndex,
  RAW_STAGING_COLLECTION,
  recoverIngestionBatch,
  resolveIngestionDatabaseConfig,
  RESTAURANTS_COLLECTION,
  rollbackIngestionBatch,
  rolloutIngestionIndexes,
  runRestaurantIngestionPipeline,
  STANDALONE_MONGODB_LIMITATION_NOTE,
  UNIQUE_EXTERNAL_SOURCE_INDEX_NAME,
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
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length && a.every((item, idx) => valuesEqual(item, b[idx]))
    );
  }
  if (
    a !== null &&
    b !== null &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    !(a instanceof Date) &&
    !(b instanceof Date) &&
    !(a instanceof ObjectId) &&
    !(b instanceof ObjectId)
  ) {
    const recA = a as Record<string, unknown>;
    const recB = b as Record<string, unknown>;
    const keysA = Object.keys(recA);
    const keysB = Object.keys(recB);
    return (
      keysA.length === keysB.length &&
      keysA.every((k) => k in recB && valuesEqual(recA[k], recB[k]))
    );
  }
  return a === b;
}

function matchesFilter(
  doc: StoredDoc,
  filter: Record<string, unknown>,
): boolean {
  for (const [key, cond] of Object.entries(filter)) {
    if (key === '$and' && Array.isArray(cond)) {
      const allMatch = cond.every((sub) =>
        matchesFilter(doc, sub as Record<string, unknown>),
      );
      if (!allMatch) return false;
      continue;
    }

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
      if ('$type' in condObj && condObj.$type === 'string') {
        if (typeof val !== 'string') return false;
        continue;
      }
      if ('$gt' in condObj) {
        const gtTarget = condObj.$gt;
        if (typeof val === 'number' && typeof gtTarget === 'number') {
          if (val <= gtTarget) return false;
          continue;
        }
        if (
          (val instanceof ObjectId || typeof val === 'string') &&
          (gtTarget instanceof ObjectId || typeof gtTarget === 'string')
        ) {
          if (String(val) <= String(gtTarget)) return false;
          continue;
        }
        return false;
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
  public readonly findLimits: Array<number | undefined> = [];
  public readonly deleteOneFilters: Array<Record<string, unknown>> = [];
  public readonly updateOneFilters: Array<Record<string, unknown>> = [];
  public readonly createdIndexes: Array<{
    spec: Record<string, unknown>;
    options: Record<string, unknown>;
  }> = [];
  public readonly aggregatePipelines: Array<Array<Record<string, unknown>>> =
    [];
  public beforeInsertOne?: (doc: Record<string, unknown>) => void;
  public beforeUpdateOne?: (
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
  ) => void;
  public beforeDeleteOne?: (filter: Record<string, unknown>) => void;
  public beforeBulkWrite?: (ops: Array<Record<string, unknown>>) => void;

  constructor(public readonly docs: StoredDoc[] = []) {}

  find(filter: Record<string, unknown> = {}) {
    this.findFilters.push({ ...filter });
    const matched = this.docs.filter((d) => matchesFilter(d, filter));
    let cap: number | undefined;
    let sortSpec: Record<string, number> | undefined;
    const cursor = {
      sort: (spec: Record<string, number>) => {
        sortSpec = spec;
        return cursor;
      },
      limit: (n: number) => {
        cap = n;
        return cursor;
      },
      toArray: () => {
        this.findLimits.push(cap);
        const ordered = [...matched];
        if (sortSpec && '_id' in sortSpec) {
          const dir = sortSpec._id;
          ordered.sort((a, b) => {
            const as = String(a._id);
            const bs = String(b._id);
            return dir < 0 ? bs.localeCompare(as) : as.localeCompare(bs);
          });
        }
        const sliced = cap !== undefined ? ordered.slice(0, cap) : ordered;
        return Promise.resolve(sliced.map((d) => ({ ...d })));
      },
    };
    return cursor;
  }

  findOne(filter: Record<string, unknown> = {}): Promise<StoredDoc | null> {
    const found = this.docs.find((d) => matchesFilter(d, filter));
    return Promise.resolve(found ? { ...found } : null);
  }

  countDocuments(filter: Record<string, unknown> = {}): Promise<number> {
    return Promise.resolve(
      this.docs.filter((d) => matchesFilter(d, filter)).length,
    );
  }

  createIndex(
    spec: Record<string, unknown>,
    options: Record<string, unknown> = {},
  ): Promise<string> {
    this.createdIndexes.push({ spec: { ...spec }, options: { ...options } });
    return Promise.resolve(
      typeof options.name === 'string'
        ? options.name
        : Object.keys(spec).join('_'),
    );
  }

  aggregate(pipeline: Array<Record<string, unknown>>) {
    this.aggregatePipelines.push(pipeline);
    const runStages = (
      inputRows: Array<Record<string, unknown>>,
      stages: Array<Record<string, unknown>>,
    ): Array<Record<string, unknown>> => {
      let rows = inputRows.map((d) => ({ ...d }));

      for (const stage of stages) {
        if ('$match' in stage && stage.$match) {
          const matchFilter = stage.$match as Record<string, unknown>;
          rows = rows.filter((r) => matchesFilter(r as StoredDoc, matchFilter));
        } else if ('$group' in stage && stage.$group) {
          const groupSpec = stage.$group as Record<string, unknown>;
          const idSpec = groupSpec._id;
          const grouped = new Map<string, Record<string, unknown>>();

          for (const row of rows) {
            let groupId: unknown = null;
            if (idSpec && typeof idSpec === 'object') {
              const idObj: Record<string, unknown> = {};
              for (const [k, expr] of Object.entries(
                idSpec as Record<string, string>,
              )) {
                const fieldName = expr.startsWith('$') ? expr.slice(1) : expr;
                idObj[k] = row[fieldName];
              }
              groupId = idObj;
            }
            const mapKey = JSON.stringify(groupId);
            let bucket = grouped.get(mapKey);
            if (!bucket) {
              bucket = { _id: groupId };
              for (const [field, accSpec] of Object.entries(groupSpec)) {
                if (field === '_id') continue;
                const accObj = accSpec as Record<string, unknown>;
                if ('$sum' in accObj) {
                  bucket[field] = 0;
                } else if ('$firstN' in accObj || '$push' in accObj) {
                  bucket[field] = [];
                }
              }
              grouped.set(mapKey, bucket);
            }

            for (const [field, accSpec] of Object.entries(groupSpec)) {
              if (field === '_id') continue;
              const accObj = accSpec as Record<string, unknown>;
              if ('$sum' in accObj) {
                const sumExpr = accObj.$sum;
                const inc =
                  typeof sumExpr === 'number'
                    ? sumExpr
                    : typeof sumExpr === 'string' && sumExpr.startsWith('$')
                      ? Number(row[sumExpr.slice(1)] ?? 0)
                      : 0;
                bucket[field] = Number(bucket[field] ?? 0) + inc;
              } else if ('$firstN' in accObj) {
                const firstNSpec = accObj.$firstN as {
                  input: string;
                  n: number;
                };
                const arr = bucket[field] as unknown[];
                if (arr.length < firstNSpec.n) {
                  const fieldName = firstNSpec.input.startsWith('$')
                    ? firstNSpec.input.slice(1)
                    : firstNSpec.input;
                  arr.push(row[fieldName]);
                }
              } else if ('$push' in accObj) {
                const pushExpr = String(accObj.$push);
                const fieldName = pushExpr.startsWith('$')
                  ? pushExpr.slice(1)
                  : pushExpr;
                (bucket[field] as unknown[]).push(row[fieldName]);
              }
            }
          }

          rows = Array.from(grouped.values());
        } else if ('$sort' in stage && stage.$sort) {
          const sortEntries = Object.entries(
            stage.$sort as Record<string, number>,
          );
          const getNested = (
            obj: Record<string, unknown>,
            path: string,
          ): unknown =>
            path.split('.').reduce<unknown>((cur, seg) => {
              if (cur && typeof cur === 'object') {
                return (cur as Record<string, unknown>)[seg];
              }
              return undefined;
            }, obj);
          rows.sort((a, b) => {
            for (const [sortKey, sortDir] of sortEntries) {
              const av = getNested(a, sortKey);
              const bv = getNested(b, sortKey);
              if (typeof av === 'number' && typeof bv === 'number') {
                if (av !== bv) return sortDir < 0 ? bv - av : av - bv;
              } else {
                const as =
                  typeof av === 'string' ? av : JSON.stringify(av ?? '');
                const bs =
                  typeof bv === 'string' ? bv : JSON.stringify(bv ?? '');
                if (as !== bs) {
                  return sortDir < 0
                    ? bs.localeCompare(as)
                    : as.localeCompare(bs);
                }
              }
            }
            return 0;
          });
        } else if ('$limit' in stage && typeof stage.$limit === 'number') {
          rows = rows.slice(0, stage.$limit);
        } else if ('$facet' in stage && stage.$facet) {
          const facetSpec = stage.$facet as Record<
            string,
            Array<Record<string, unknown>>
          >;
          const facetOut: Record<string, Array<Record<string, unknown>>> = {};
          for (const [facetName, subPipeline] of Object.entries(facetSpec)) {
            facetOut[facetName] = runStages(rows, subPipeline);
          }
          rows = [facetOut];
        }
      }

      return rows;
    };

    const resultRows = runStages(this.docs, pipeline);
    return {
      toArray: () => Promise.resolve(resultRows),
    };
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
    this.updateOneFilters.push({ ...filter });
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

  deleteOne(filter: Record<string, unknown>) {
    this.deleteOneFilters.push({ ...filter });
    if (this.beforeDeleteOne) {
      this.beforeDeleteOne(filter);
    }
    const idx = this.docs.findIndex((d) => matchesFilter(d, filter));
    if (idx !== -1) {
      this.docs.splice(idx, 1);
      return Promise.resolve({ deletedCount: 1 });
    }
    return Promise.resolve({ deletedCount: 0 });
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

  describe('PR #15 Review Fixes: deleteOne CAS safety, indexed dedup queries & concurrency guarantees', () => {
    it('enforces explicit protected-field CAS conditions via deleteOne and blocks deletion if protected fields mutate mid-rollback', async () => {
      const protectedCases: Array<{
        label: string;
        mutate: (doc: StoredDoc) => void;
      }> = [
        {
          label: 'isVerified flipped true',
          mutate: (d) => {
            d.isVerified = true;
          },
        },
        {
          label: 'isFeatured flipped true',
          mutate: (d) => {
            d.isFeatured = true;
          },
        },
        {
          label: 'ownerId assigned',
          mutate: (d) => {
            d.ownerId = new ObjectId();
          },
        },
        {
          label: 'reviewsCount incremented',
          mutate: (d) => {
            d.reviewsCount = 1;
          },
        },
        {
          label: 'tracked field tenQuan modified concurrently',
          mutate: (d) => {
            d.tenQuan = 'Concurrent Change';
          },
        },
      ];

      for (const testCase of protectedCases) {
        const { db, collections } = createInMemoryDb();
        await runRestaurantIngestionPipeline(db, {
          rawContent: JSON.stringify([
            {
              RestaurantID: 9001,
              Name: `Quán CAS Delete (${testCase.label})`,
              Address: '10 Nguyễn Huệ',
              Latitude: 10.774,
              Longtitude: 106.703,
              AvgRating: 8.4,
            },
          ]),
          batchId: 'batch_del_cas',
          mode: 'apply',
        });

        collections[RESTAURANTS_COLLECTION].beforeDeleteOne = () => {
          const target = collections[RESTAURANTS_COLLECTION].docs[0];
          if (target) {
            testCase.mutate(target);
          }
        };

        const rb = await rollbackIngestionBatch(db, 'batch_del_cas', {
          dryRun: false,
        });
        collections[RESTAURANTS_COLLECTION].beforeDeleteOne = undefined;

        expect(rb.status).toBe('conflict');
        expect(rb.deletedInsertedCount).toBe(0);
        expect(rb.conflicts).toHaveLength(1);
        expect(rb.conflicts[0].reasonCode).toBe('CAS_WRITE_MISMATCH');
        expect(collections[RESTAURANTS_COLLECTION].docs).toHaveLength(1);

        // Verify deleteOne CAS filter included explicit protected & version fields
        const usedFilter =
          collections[RESTAURANTS_COLLECTION].deleteOneFilters[0];
        expect(usedFilter).toBeDefined();
        expect(usedFilter.ingestionBatchId).toBe('batch_del_cas');
        expect(usedFilter.ingestionRevision).toBe(1);
        expect(typeof usedFilter.ingestionPostDigest).toBe('string');
        expect(usedFilter.updatedAt).toBeInstanceOf(Date);
        expect(usedFilter.$and).toEqual(
          expect.arrayContaining([
            { ownerId: { $exists: false } },
            {
              $or: [{ reviewsCount: 0 }, { reviewsCount: { $exists: false } }],
            },
            {
              $or: [{ isVerified: false }, { isVerified: { $exists: false } }],
            },
            {
              $or: [{ isFeatured: false }, { isFeatured: { $exists: false } }],
            },
          ]),
        );
      }
    });

    it('blocks updateOne rollback via field/revision CAS if a concurrent writer modifies a tracked catalog field between digest check and final write', async () => {
      const preId = new ObjectId();
      const { db, collections } = createInMemoryDb([
        {
          _id: preId,
          externalSource: EXTERNAL_SOURCE_FOODY,
          externalSourceId: '9002',
          tenQuan: 'Bánh Cuốn Tây Sơn',
          diaChi: '127 Phạm Văn Hai',
          giaCa: '35.000đ',
          reviewsCount: 0,
          isVerified: false,
          isFeatured: false,
          createdAt: new Date('2025-01-01T00:00:00Z'),
        },
      ]);

      await runRestaurantIngestionPipeline(db, {
        rawContent: JSON.stringify([
          {
            RestaurantID: 9002,
            Name: 'Bánh Cuốn Tây Sơn',
            Address: '127 Phạm Văn Hai',
            Latitude: 10.799,
            Longtitude: 106.665,
            AvgRating: 8.6,
            PriceMin: 40000,
            PriceMax: 65000,
          },
        ]),
        batchId: 'batch_upd_race',
        mode: 'apply',
      });

      // Simulate a concurrent non-CAS writer mutating giaCa WITHOUT changing updatedAt or ingestionRevision
      collections[RESTAURANTS_COLLECTION].beforeUpdateOne = () => {
        const doc = collections[RESTAURANTS_COLLECTION].docs[0];
        if (doc) {
          doc.giaCa = '99.000đ';
        }
      };

      const rb = await rollbackIngestionBatch(db, 'batch_upd_race', {
        dryRun: false,
      });
      collections[RESTAURANTS_COLLECTION].beforeUpdateOne = undefined;

      expect(rb.status).toBe('conflict');
      expect(rb.restoredUpdatedCount).toBe(0);
      expect(rb.conflicts[0].reasonCode).toBe('CAS_WRITE_MISMATCH');
      // Concurrent mutation must NOT be overwritten
      expect(collections[RESTAURANTS_COLLECTION].docs[0].giaCa).toBe('99.000đ');
      const casFilter =
        collections[RESTAURANTS_COLLECTION].updateOneFilters.at(-1);
      expect(casFilter?.ingestionRevision).toBe(1);
      expect(typeof casFilter?.ingestionPostDigest).toBe('string');
      expect(casFilter?.giaCa).toBe('40.000đ - 65.000đ');
    });

    it('uses index-aligned deduplication predicates (compound source+id, slug, url, name+address) with result limit and avoids broad name regex', async () => {
      const matchingLegacyId = new ObjectId();
      const sameNameDiffAddrId = new ObjectId();
      const { db, collections } = createInMemoryDb([
        {
          _id: matchingLegacyId,
          tenQuan: 'Phở Phú Vương',
          diaChi: '120 Nguyễn Thái Bình, Q1',
          giaCa: '50.000đ',
          reviewsCount: 0,
        },
        {
          _id: sameNameDiffAddrId,
          tenQuan: 'Phở Phú Vương',
          diaChi: '339 Lê Văn Sỹ, Tân Bình',
          giaCa: '50.000đ',
          reviewsCount: 0,
        },
      ]);

      const res = await runRestaurantIngestionPipeline(db, {
        rawContent: JSON.stringify([
          {
            RestaurantID: 9010,
            Name: 'Phở Phú Vương',
            Address: '120 Nguyễn Thái Bình, Q1',
            Latitude: 10.769,
            Longtitude: 106.697,
            AvgRating: 8.5,
            ResUrlRewrite: 'pho-phu-vuong-q1',
            MicrositeUrl: '/ho-chi-minh/pho-phu-vuong-q1',
          },
        ]),
        batchId: 'batch_indexed_dedup',
        mode: 'apply',
      });

      expect(res.metrics.updated_count).toBe(1);
      expect(res.metrics.inserted_count).toBe(0);

      // Same-name different-address doc must stay untouched
      const untouched = collections[RESTAURANTS_COLLECTION].docs.find(
        (d) => String(d._id) === sameNameDiffAddrId.toString(),
      );
      expect(untouched?.ingestionBatchId).toBeUndefined();

      // Inspect executed query filters and limits
      const dedupFilter = collections[RESTAURANTS_COLLECTION].findFilters[0];
      const clauses = dedupFilter.$or as Array<Record<string, unknown>>;
      expect(Array.isArray(clauses)).toBe(true);
      expect(clauses).toEqual(
        expect.arrayContaining([
          {
            externalSource: EXTERNAL_SOURCE_FOODY,
            externalSourceId: '9010',
          },
          { slug: { $in: ['pho-phu-vuong-q1'] } },
          {
            urlGoc: {
              $in: [
                'https://www.foody.vn/ho-chi-minh/pho-phu-vuong-q1',
                'https://www.foody.vn/ho-chi-minh/pho-phu-vuong-q1/',
              ],
            },
          },
          {
            normalizedNameAddressKey: {
              $in: ['phở phú vương::120 nguyễn thái bình, q1'],
            },
          },
          {
            tenQuan: 'Phở Phú Vương',
            diaChi: '120 Nguyễn Thái Bình, Q1',
          },
        ]),
      );

      // Must NOT contain broad $regex or standalone tenQuan filter without diaChi
      expect(JSON.stringify(clauses)).not.toContain('$regex');
      expect(clauses.some((c) => 'tenQuan' in c && !('diaChi' in c))).toBe(
        false,
      );
      // Bounded cursor limit+1 overflow sentinel enforced per chunk
      expect(collections[RESTAURANTS_COLLECTION].findLimits[0]).toBe(5);
    });
  });

  describe('Final review fixes: dedup limit+1 overflow & safe index rollout', () => {
    const singleCandidateJson = JSON.stringify([
      {
        RestaurantID: '9500',
        Name: 'Bánh Mì Huynh Hoa',
        Address: '26 Lê Thị Riêng, Q1',
        ResUrlRewrite: 'banh-mi-huynh-hoa',
        MicrositeUrl: '/ho-chi-minh/banh-mi-huynh-hoa',
        Latitude: 10.7712,
        Longtitude: 106.6915,
        Category: 'Bánh mì',
        PriceRange: '50k - 70k',
        AvgRating: 8.8,
      },
    ]);

    it('requests limit+1 and passes cleanly when matches equal chunkLimit without overflow', async () => {
      const existingId = new ObjectId();
      const { db, collections } = createInMemoryDb([
        {
          _id: existingId,
          tenQuan: 'Bánh Mì Huynh Hoa',
          diaChi: '26 Lê Thị Riêng, Q1',
          slug: 'banh-mi-huynh-hoa',
          urlGoc: 'https://www.foody.vn/ho-chi-minh/banh-mi-huynh-hoa',
          externalSource: EXTERNAL_SOURCE_FOODY,
          externalSourceId: '9500',
          diemDanhGia: 4.4,
          sourceRatingRaw: 8.8,
          sourceRatingScale: 10,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ]);

      const summary = await runRestaurantIngestionPipeline(db, {
        rawContent: singleCandidateJson,
        format: 'json',
        mode: 'apply',
        batchId: 'batch-dedup-exact-boundary',
        maxDedupResultsPerChunkFactor: 1,
      });

      expect(collections[RESTAURANTS_COLLECTION].findLimits[0]).toBe(2);
      expect(summary.metrics.matched_count).toBe(1);
      expect(summary.metrics.updated_count).toBe(1);
      expect(summary.metrics.inserted_count).toBe(0);
    });

    it('detects dedup cursor limit overflow (> chunkLimit) and aborts before any writes', async () => {
      const legacyId1 = new ObjectId();
      const legacyId2 = new ObjectId();
      const { db, collections } = createInMemoryDb([
        {
          _id: legacyId1,
          tenQuan: 'Bánh Mì Huynh Hoa Legacy A',
          diaChi: '26 Lê Thị Riêng, Q1',
          slug: 'banh-mi-huynh-hoa',
          createdAt: new Date('2025-01-01T00:00:00Z'),
          updatedAt: new Date('2025-01-01T00:00:00Z'),
        },
        {
          _id: legacyId2,
          tenQuan: 'Bánh Mì Huynh Hoa Legacy B',
          diaChi: '26 Lê Thị Riêng, Q1',
          urlGoc: 'https://www.foody.vn/ho-chi-minh/banh-mi-huynh-hoa',
          createdAt: new Date('2025-01-02T00:00:00Z'),
          updatedAt: new Date('2025-01-02T00:00:00Z'),
        },
      ]);

      await expect(
        runRestaurantIngestionPipeline(db, {
          rawContent: singleCandidateJson,
          format: 'json',
          mode: 'apply',
          batchId: 'batch-dedup-overflow',
          maxDedupResultsPerChunkFactor: 1,
        }),
      ).rejects.toThrow(IngestionValidationError);

      // Requested limit+1 = 2, overflow detected (> 1) before any writes occur
      expect(collections[RESTAURANTS_COLLECTION].findLimits[0]).toBe(2);
      expect(collections[RESTAURANTS_COLLECTION].docs).toHaveLength(2);
      expect(collections[RAW_STAGING_COLLECTION].docs).toHaveLength(0);
      expect(collections[INGESTION_BATCHES_COLLECTION].docs).toHaveLength(0);
    });

    it('rejects invalid maxDedupResultsPerChunkFactor values', async () => {
      const { db } = createInMemoryDb([]);
      await expect(
        runRestaurantIngestionPipeline(db, {
          rawContent: singleCandidateJson,
          format: 'json',
          mode: 'dry-run',
          batchId: 'batch-invalid-factor',
          maxDedupResultsPerChunkFactor: 0,
        }),
      ).rejects.toThrow(IngestionValidationError);
    });

    it('preflights duplicate (externalSource, externalSourceId) pairs non-destructively and blocks unique index rollout', async () => {
      const dupId1 = new ObjectId();
      const dupId2 = new ObjectId();
      const { db, collections } = createInMemoryDb([
        {
          _id: dupId1,
          tenQuan: 'Quán Duplicate A',
          externalSource: EXTERNAL_SOURCE_FOODY,
          externalSourceId: '8888',
        },
        {
          _id: dupId2,
          tenQuan: 'Quán Duplicate B',
          externalSource: EXTERNAL_SOURCE_FOODY,
          externalSourceId: '8888',
        },
        {
          _id: new ObjectId(),
          tenQuan: 'Quán Clean',
          externalSource: EXTERNAL_SOURCE_FOODY,
          externalSourceId: '8889',
        },
      ]);

      const report = await preflightExternalSourceUniqueIndex(db);
      expect(report.scannedCount).toBe(3);
      expect(report.duplicateGroupCount).toBe(1);
      expect(report.safeToCreateUniqueIndex).toBe(false);
      expect(report.indexCreated).toBe(false);
      expect(report.duplicates[0]).toMatchObject({
        externalSource: EXTERNAL_SOURCE_FOODY,
        externalSourceId: '8888',
        count: 2,
      });
      expect(report.duplicates[0].docIds).toEqual(
        expect.arrayContaining([dupId1.toString(), dupId2.toString()]),
      );
      expect(report.remediationSteps.length).toBeGreaterThan(0);

      // Both dryRun and apply rollout must refuse to create unique index or alter data
      await expect(
        rolloutIngestionIndexes(db, { dryRun: true }),
      ).rejects.toThrow(IngestionValidationError);
      await expect(
        rolloutIngestionIndexes(db, { dryRun: false }),
      ).rejects.toThrow(IngestionValidationError);

      expect(collections[RESTAURANTS_COLLECTION].docs).toHaveLength(3);
      expect(collections[RESTAURANTS_COLLECTION].createdIndexes).toHaveLength(
        0,
      );
    });

    it('rolls out partial unique index cleanly only after zero duplicates are verified', async () => {
      const { db, collections } = createInMemoryDb([
        {
          _id: new ObjectId(),
          tenQuan: 'Quán Clean A',
          externalSource: EXTERNAL_SOURCE_FOODY,
          externalSourceId: '9901',
        },
        {
          _id: new ObjectId(),
          tenQuan: 'Quán Clean B',
          externalSource: EXTERNAL_SOURCE_FOODY,
          externalSourceId: '9902',
        },
      ]);

      const dryPreview = await rolloutIngestionIndexes(db, { dryRun: true });
      expect(dryPreview.safeToCreateUniqueIndex).toBe(true);
      expect(dryPreview.indexCreated).toBe(false);
      expect(dryPreview.dryRun).toBe(true);
      expect(collections[RESTAURANTS_COLLECTION].createdIndexes).toHaveLength(
        0,
      );

      const applied = await rolloutIngestionIndexes(db, { dryRun: false });
      expect(applied.safeToCreateUniqueIndex).toBe(true);
      expect(applied.indexCreated).toBe(true);
      expect(applied.dryRun).toBe(false);

      const uniqueIdxCall =
        collections[RESTAURANTS_COLLECTION].createdIndexes[0];
      expect(uniqueIdxCall.spec).toEqual({
        externalSource: 1,
        externalSourceId: 1,
      });
      expect(uniqueIdxCall.options).toEqual({
        name: UNIQUE_EXTERNAL_SOURCE_INDEX_NAME,
        unique: true,
        partialFilterExpression: {
          externalSource: { $type: 'string' },
          externalSourceId: { $type: 'string' },
        },
      });
    });

    it('validates --preflight-indexes and --ensure-indexes CLI flags safely', () => {
      expect(parseIngestionCliArgs(['--preflight-indexes'])).toEqual({
        mode: 'preflight-indexes',
        dryRun: true,
        format: 'auto',
        reportOutPath: undefined,
      });

      expect(() =>
        parseIngestionCliArgs(['--preflight-indexes', '--apply']),
      ).toThrow(IngestionValidationError);

      expect(parseIngestionCliArgs(['--ensure-indexes'])).toEqual({
        mode: 'ensure-indexes',
        dryRun: true,
        format: 'auto',
        reportOutPath: undefined,
      });

      expect(parseIngestionCliArgs(['--ensure-indexes', '--apply'])).toEqual({
        mode: 'ensure-indexes',
        dryRun: false,
        format: 'auto',
        reportOutPath: undefined,
      });

      expect(() =>
        parseIngestionCliArgs(['--preflight-indexes', '--ensure-indexes']),
      ).toThrow(IngestionValidationError);
    });

    it('does not attach boot-time unique:true on RestaurantSchema (externalSource, externalSourceId) index', () => {
      const schemaIndexes = RestaurantSchema.indexes();
      const extIndex = schemaIndexes.find(
        ([spec]) => 'externalSource' in spec && 'externalSourceId' in spec,
      );
      expect(extIndex).toBeDefined();
      const [, extOpts] = extIndex!;
      expect((extOpts as { unique?: boolean }).unique).not.toBe(true);
    });
  });

  describe('Final hardening: preflight reporting accuracy, bounded memory & legacy key compatibility', () => {
    it('reports true total duplicateGroupCount and totalAffectedDocuments independently when > 200 duplicate groups exist', async () => {
      const docs: StoredDoc[] = [];
      const totalGroups = 215;
      for (let g = 0; g < totalGroups; g += 1) {
        const sourceId = `dup-group-${g}`;
        docs.push(
          {
            _id: new ObjectId(),
            tenQuan: `Restaurant ${g} A`,
            externalSource: EXTERNAL_SOURCE_FOODY,
            externalSourceId: sourceId,
          },
          {
            _id: new ObjectId(),
            tenQuan: `Restaurant ${g} B`,
            externalSource: EXTERNAL_SOURCE_FOODY,
            externalSourceId: sourceId,
          },
        );
      }

      const { db, collections } = createInMemoryDb(docs);
      const report = await preflightExternalSourceUniqueIndex(db);

      expect(report.scannedCount).toBe(430);
      expect(report.duplicateGroupCount).toBe(215);
      expect(report.displayedDuplicateGroupCount).toBe(
        MAX_DUPLICATE_GROUP_SAMPLES,
      );
      expect(report.duplicates).toHaveLength(MAX_DUPLICATE_GROUP_SAMPLES);
      expect(report.totalAffectedDocuments).toBe(430);
      expect(report.safeToCreateUniqueIndex).toBe(false);
      expect(report.indexCreated).toBe(false);
      expect(report.remediationSteps.length).toBeGreaterThan(0);

      await expect(
        rolloutIngestionIndexes(db, { dryRun: false }),
      ).rejects.toThrow(IngestionValidationError);
      expect(collections[RESTAURANTS_COLLECTION].createdIndexes).toHaveLength(
        0,
      );
    });

    it('bounds per-group docIds and names via MongoDB 7.0 $firstN for very large duplicate groups while preserving actual count', async () => {
      const docs: StoredDoc[] = [];
      const hugeGroupSize = 250;
      for (let i = 0; i < hugeGroupSize; i += 1) {
        docs.push({
          _id: new ObjectId(),
          tenQuan: `Huge Duplicate ${i}`,
          externalSource: EXTERNAL_SOURCE_FOODY,
          externalSourceId: 'huge-group-1',
        });
      }

      const { db, collections } = createInMemoryDb(docs);
      const report = await preflightExternalSourceUniqueIndex(db);

      expect(report.duplicateGroupCount).toBe(1);
      expect(report.displayedDuplicateGroupCount).toBe(1);
      expect(report.totalAffectedDocuments).toBe(hugeGroupSize);
      expect(report.safeToCreateUniqueIndex).toBe(false);
      expect(report.duplicates[0].count).toBe(hugeGroupSize);
      expect(report.duplicates[0].docIds).toHaveLength(
        MAX_SAMPLE_DOCS_PER_GROUP,
      );
      expect(report.duplicates[0].names).toHaveLength(
        MAX_SAMPLE_DOCS_PER_GROUP,
      );
      expect(report.duplicates[0].sampleTruncated).toBe(true);

      const pipelineJson = JSON.stringify(
        collections[RESTAURANTS_COLLECTION].aggregatePipelines[0],
      );
      expect(pipelineJson).toContain('$firstN');
      expect(pipelineJson).toContain('$facet');
      expect(pipelineJson).not.toContain('$push');
    });

    it('matches exact legacy docs without normalizedNameAddressKey, and resolves casing/whitespace drift cleanly via non-destructive backfill', async () => {
      const exactLegacyId = new ObjectId();
      const driftedLegacyId = new ObjectId();
      const { db, collections } = createInMemoryDb([
        {
          _id: exactLegacyId,
          tenQuan: 'Phở Phú Vương',
          diaChi: '120 Nguyễn Thái Bình, Q1',
          reviewsCount: 5,
          isVerified: true,
        },
        {
          _id: driftedLegacyId,
          tenQuan: 'BÚN BÒ   HUẾ ĐÔNG BA',
          diaChi: ' 110A Nguyễn Du, Q1 ',
          ownerId: new ObjectId(),
          reviewsCount: 12,
          isVerified: true,
        },
      ]);

      // 1. Exact tenQuan+diaChi legacy record without normalizedNameAddressKey still matches via Tier 4 exact compound fallback
      const exactMatchSummary = await runRestaurantIngestionPipeline(db, {
        rawContent: JSON.stringify([
          {
            RestaurantID: '9601',
            Name: 'Phở Phú Vương',
            Address: '120 Nguyễn Thái Bình, Q1',
            Latitude: 10.769,
            Longtitude: 106.697,
            AvgRating: 8.4,
          },
        ]),
        batchId: 'batch-legacy-exact',
        mode: 'apply',
      });
      expect(exactMatchSummary.metrics.matched_count).toBe(1);
      expect(exactMatchSummary.metrics.inserted_count).toBe(0);

      // 2. Dry-run backfill inspects missing normalizedNameAddressKey without modifying existing docs
      const dryBackfill = await backfillLegacyNormalizedKeys(db, {
        dryRun: true,
      });
      expect(dryBackfill.dryRun).toBe(true);
      expect(dryBackfill.missingKeyCount).toBe(1);
      expect(dryBackfill.computableCount).toBe(1);
      expect(dryBackfill.updatedCount).toBe(0);

      const driftedBefore = collections[RESTAURANTS_COLLECTION].docs.find(
        (d) => String(d._id) === driftedLegacyId.toString(),
      );
      expect(driftedBefore?.normalizedNameAddressKey).toBeUndefined();

      // 3. Apply non-destructive backfill: populates ONLY normalizedNameAddressKey, preserves ownerId/reviewsCount/tenQuan/diaChi
      const appliedBackfill = await backfillLegacyNormalizedKeys(db, {
        dryRun: false,
      });
      expect(appliedBackfill.dryRun).toBe(false);
      expect(appliedBackfill.updatedCount).toBe(1);

      const driftedAfter = collections[RESTAURANTS_COLLECTION].docs.find(
        (d) => String(d._id) === driftedLegacyId.toString(),
      );
      expect(driftedAfter?.normalizedNameAddressKey).toBe(
        'bún bò huế đông ba::110a nguyễn du, q1',
      );
      expect(driftedAfter?.tenQuan).toBe('BÚN BÒ   HUẾ ĐÔNG BA');
      expect(driftedAfter?.reviewsCount).toBe(12);
      expect(driftedAfter?.ownerId).toBeDefined();

      // 4. Subsequent ingestion with standard casing/spacing now matches the drifted legacy doc reliably
      const driftedMatchSummary = await runRestaurantIngestionPipeline(db, {
        rawContent: JSON.stringify([
          {
            RestaurantID: '9602',
            Name: 'Bún Bò Huế Đông Ba',
            Address: '110A Nguyễn Du, Q1',
            Latitude: 10.773,
            Longtitude: 106.695,
            AvgRating: 8.6,
          },
        ]),
        batchId: 'batch-legacy-after-backfill',
        mode: 'apply',
      });
      expect(driftedMatchSummary.metrics.matched_count).toBe(1);
      expect(driftedMatchSummary.metrics.inserted_count).toBe(0);
    });

    it('processes large legacy collections in bounded _id-keyset batches without full-collection materialization', async () => {
      const docs: StoredDoc[] = [];
      for (let i = 0; i < 25; i += 1) {
        docs.push({
          _id: new ObjectId(),
          tenQuan: `Legacy Restaurant ${i}`,
          diaChi: `${i + 1} Lê Lợi, Q1`,
          ownerId: new ObjectId(),
          reviewsCount: i,
          isVerified: i % 2 === 0,
          isFeatured: i % 3 === 0,
        });
      }
      // 2 uncomputable docs missing diaChi
      docs.push(
        { _id: new ObjectId(), tenQuan: 'No Address A', diaChi: '' },
        { _id: new ObjectId(), tenQuan: 'No Address B' },
      );
      // 5 docs already having normalizedNameAddressKey (must never be overwritten)
      for (let i = 0; i < 5; i += 1) {
        docs.push({
          _id: new ObjectId(),
          tenQuan: `Already Populated ${i}`,
          diaChi: `${i + 1} Hai Bà Trưng, Q1`,
          normalizedNameAddressKey: `custom-existing-key-${i}`,
        });
      }

      const { db, collections } = createInMemoryDb(docs);

      // Dry-run default processes in bounded batches of 6 with zero mutations
      const dryRunRes = await backfillLegacyNormalizedKeys(db, {
        batchSize: 6,
      });
      expect(dryRunRes.dryRun).toBe(true);
      expect(dryRunRes.batchSize).toBe(6);
      expect(dryRunRes.batchesProcessed).toBe(5);
      expect(dryRunRes.scannedCount).toBe(32);
      expect(dryRunRes.missingKeyCount).toBe(27);
      expect(dryRunRes.computableCount).toBe(25);
      expect(dryRunRes.uncomputableCount).toBe(2);
      expect(dryRunRes.updatedCount).toBe(0);
      expect(
        collections[RESTAURANTS_COLLECTION].findLimits.every((l) => l === 6),
      ).toBe(true);
      expect(collections[RESTAURANTS_COLLECTION].updateOneFilters).toHaveLength(
        0,
      );

      // Apply in bounded batches of 6
      collections[RESTAURANTS_COLLECTION].findLimits.length = 0;
      const applyRes = await backfillLegacyNormalizedKeys(db, {
        dryRun: false,
        batchSize: 6,
      });
      expect(applyRes.dryRun).toBe(false);
      expect(applyRes.batchesProcessed).toBe(5);
      expect(applyRes.scannedCount).toBe(32);
      expect(applyRes.missingKeyCount).toBe(27);
      expect(applyRes.computableCount).toBe(25);
      expect(applyRes.uncomputableCount).toBe(2);
      expect(applyRes.updatedCount).toBe(25);
      expect(applyRes.skippedConcurrentOrAlreadySetCount).toBe(0);
      expect(
        collections[RESTAURANTS_COLLECTION].findLimits.every((l) => l === 6),
      ).toBe(true);

      // Protected fields and pre-existing normalizedNameAddressKey values stay intact
      for (let i = 0; i < 25; i += 1) {
        expect(docs[i].normalizedNameAddressKey).toBe(
          `legacy restaurant ${i}::${i + 1} lê lợi, q1`,
        );
        expect(docs[i].tenQuan).toBe(`Legacy Restaurant ${i}`);
        expect(docs[i].reviewsCount).toBe(i);
        expect(docs[i].ownerId).toBeDefined();
      }
      for (let i = 0; i < 5; i += 1) {
        expect(docs[27 + i].normalizedNameAddressKey).toBe(
          `custom-existing-key-${i}`,
        );
      }
    });

    it('skips concurrent normalizedNameAddressKey updates cleanly via CAS and rejects invalid batchSize', async () => {
      const targetId = new ObjectId();
      const { db, collections } = createInMemoryDb([
        {
          _id: targetId,
          tenQuan: 'Cơm Tấm Cali',
          diaChi: '236 Lê Thánh Tôn, Q1',
        },
      ]);

      collections[RESTAURANTS_COLLECTION].beforeUpdateOne = () => {
        const target = collections[RESTAURANTS_COLLECTION].docs[0];
        if (target) {
          target.normalizedNameAddressKey = 'concurrently-populated-key';
        }
      };

      const res = await backfillLegacyNormalizedKeys(db, {
        dryRun: false,
        batchSize: 10,
      });
      collections[RESTAURANTS_COLLECTION].beforeUpdateOne = undefined;

      expect(res.missingKeyCount).toBe(1);
      expect(res.computableCount).toBe(1);
      expect(res.updatedCount).toBe(0);
      expect(res.skippedConcurrentOrAlreadySetCount).toBe(1);
      expect(
        collections[RESTAURANTS_COLLECTION].docs[0].normalizedNameAddressKey,
      ).toBe('concurrently-populated-key');

      await expect(
        backfillLegacyNormalizedKeys(db, { batchSize: 0 }),
      ).rejects.toThrow(IngestionValidationError);
    });
  });
});
