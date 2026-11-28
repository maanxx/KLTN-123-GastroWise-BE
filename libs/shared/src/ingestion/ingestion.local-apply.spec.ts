import * as fs from 'fs';
import * as path from 'path';
import { ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import {
  assertLocalIngestionApplyAllowed,
  executeControlledLocalIngestion,
  INGESTION_BATCHES_COLLECTION,
  IngestionValidationError,
  LOCAL_INGESTION_ALLOW_ENV_VAR,
  parseIngestionCliArgs,
  RAW_STAGING_COLLECTION,
  resolveIngestionDatabaseConfig,
  RESTAURANTS_COLLECTION,
  rollbackIngestionBatch,
} from './index';

type StoredDoc = Record<string, unknown> & { _id: ObjectId | string };

function matchesSimpleFilter(
  doc: StoredDoc,
  filter: Record<string, unknown>,
): boolean {
  for (const [key, cond] of Object.entries(filter)) {
    if (key === '$or' && Array.isArray(cond)) {
      if (
        !cond.some((sub) =>
          matchesSimpleFilter(doc, sub as Record<string, unknown>),
        )
      ) {
        return false;
      }
      continue;
    }
    if (key === '$and' && Array.isArray(cond)) {
      if (
        !cond.every((sub) =>
          matchesSimpleFilter(doc, sub as Record<string, unknown>),
        )
      ) {
        return false;
      }
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
        if (!condObj.$in.some((item) => String(item) === String(val))) {
          return false;
        }
        continue;
      }
      if ('$exists' in condObj) {
        if (Boolean(condObj.$exists) !== (val !== undefined)) {
          return false;
        }
        continue;
      }
    }
    if (val instanceof Date && cond instanceof Date) {
      if (val.getTime() !== cond.getTime()) return false;
      continue;
    }
    if (val instanceof ObjectId || cond instanceof ObjectId) {
      if (String(val) !== String(cond)) return false;
      continue;
    }
    if (
      typeof val === 'object' &&
      val !== null &&
      typeof cond === 'object' &&
      cond !== null
    ) {
      if (JSON.stringify(val) !== JSON.stringify(cond)) return false;
      continue;
    }
    if (val !== cond) return false;
  }
  return true;
}

class LocalMockCollection {
  constructor(public readonly docs: StoredDoc[] = []) {}

  find(filter: Record<string, unknown> = {}) {
    const matched = this.docs.filter((d) => matchesSimpleFilter(d, filter));
    let cap: number | undefined;
    const cursor = {
      limit: (n: number) => {
        cap = n;
        return cursor;
      },
      toArray: () => {
        const sliced = cap !== undefined ? matched.slice(0, cap) : matched;
        return Promise.resolve(sliced.map((d) => ({ ...d })));
      },
    };
    return cursor;
  }

  findOne(filter: Record<string, unknown> = {}): Promise<StoredDoc | null> {
    const found = this.docs.find((d) => matchesSimpleFilter(d, filter));
    return Promise.resolve(found ? { ...found } : null);
  }

  insertOne(doc: Record<string, unknown>) {
    const id = (doc._id as ObjectId | string | undefined) ?? new ObjectId();
    if (this.docs.some((d) => String(d._id) === String(id))) {
      return Promise.reject(new Error(`E11000 duplicate key: ${String(id)}`));
    }
    this.docs.push({ ...doc, _id: id });
    return Promise.resolve({ insertedId: id });
  }

  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: { upsert?: boolean } = {},
  ) {
    const existing = this.docs.find((d) => matchesSimpleFilter(d, filter));
    const setFields =
      (update.$set as Record<string, unknown> | undefined) ?? {};
    const unsetFields =
      (update.$unset as Record<string, unknown> | undefined) ?? {};

    if (existing) {
      let modified = false;
      for (const [k, v] of Object.entries(setFields)) {
        if (existing[k] !== v) {
          existing[k] = v;
          modified = true;
        }
      }
      for (const k of Object.keys(unsetFields)) {
        if (k in existing) {
          delete existing[k];
          modified = true;
        }
      }
      return Promise.resolve({
        matchedCount: 1,
        modifiedCount: modified ? 1 : 0,
        upsertedCount: 0,
      });
    }

    if (options.upsert) {
      const created: StoredDoc = {
        _id: (filter._id as ObjectId | string | undefined) ?? new ObjectId(),
        ...setFields,
      };
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
    const idx = this.docs.findIndex((d) => matchesSimpleFilter(d, filter));
    if (idx !== -1) {
      this.docs.splice(idx, 1);
      return Promise.resolve({ deletedCount: 1 });
    }
    return Promise.resolve({ deletedCount: 0 });
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

function createLocalMockDb(initialRestaurants: StoredDoc[] = []) {
  const collections: Record<string, LocalMockCollection> = {
    [RESTAURANTS_COLLECTION]: new LocalMockCollection(initialRestaurants),
    [RAW_STAGING_COLLECTION]: new LocalMockCollection(),
    [INGESTION_BATCHES_COLLECTION]: new LocalMockCollection(),
  };

  const db = {
    databaseName: 'gastro_core_test',
    collection: (name: string) => {
      if (!collections[name]) {
        collections[name] = new LocalMockCollection();
      }
      return collections[name];
    },
  } as unknown as Db;

  return { db, collections };
}

describe('M10.4 Controlled Local Restaurant Ingestion', () => {
  const fixturePath = path.resolve(
    __dirname,
    '../../../../scripts/ingestion/fixtures/m10_4_shopeefood_local_fixture.json',
  );
  const fixtureRaw = fs.readFileSync(fixturePath, 'utf8');

  const safeLocalEnv = {
    MONGODB_URI_CORE: 'mongodb://127.0.0.1:27018/gastro_core_test',
    CORE_DB_NAME: 'gastro_core_test',
  };

  const allowedApplyEnv = {
    ...safeLocalEnv,
    [LOCAL_INGESTION_ALLOW_ENV_VAR]: 'true',
  };

  it('refuses apply mode without GASTROWISE_ALLOW_LOCAL_INGESTION=true and rejects Atlas/remote/non-test DBs', async () => {
    expect(() => assertLocalIngestionApplyAllowed({})).toThrow(
      IngestionValidationError,
    );
    expect(() =>
      assertLocalIngestionApplyAllowed({
        [LOCAL_INGESTION_ALLOW_ENV_VAR]: 'false',
      }),
    ).toThrow(IngestionValidationError);
    expect(() =>
      assertLocalIngestionApplyAllowed({
        [LOCAL_INGESTION_ALLOW_ENV_VAR]: '1',
      }),
    ).toThrow(IngestionValidationError);

    const { db, collections } = createLocalMockDb();
    await expect(
      executeControlledLocalIngestion({
        rawContent: fixtureRaw,
        mode: 'apply',
        env: safeLocalEnv,
        db,
      }),
    ).rejects.toThrow(IngestionValidationError);
    expect(collections[RESTAURANTS_COLLECTION].docs).toHaveLength(0);

    // Reject Atlas SRV, mongodb.net, remote host, and production DB names
    for (const badEnv of [
      {
        MONGODB_URI_CORE:
          'mongodb+srv://user:pass@cluster0.abcde.mongodb.net/gastro_core_test',
        CORE_DB_NAME: 'gastro_core_test',
        [LOCAL_INGESTION_ALLOW_ENV_VAR]: 'true',
      },
      {
        MONGODB_URI_CORE: 'mongodb://10.0.0.5:27017/gastro_core_test',
        CORE_DB_NAME: 'gastro_core_test',
        [LOCAL_INGESTION_ALLOW_ENV_VAR]: 'true',
      },
      {
        MONGODB_URI_CORE: 'mongodb://127.0.0.1:27017/gastro_core',
        CORE_DB_NAME: 'gastro_core',
        [LOCAL_INGESTION_ALLOW_ENV_VAR]: 'true',
      },
    ]) {
      await expect(
        executeControlledLocalIngestion({
          rawContent: fixtureRaw,
          mode: 'apply',
          env: badEnv,
          db,
        }),
      ).rejects.toThrow(IngestionValidationError);
    }

    // Supports Docker MONGO_HOST composition only for approved local hosts + gastro_core_test
    const dockerCfg = resolveIngestionDatabaseConfig({
      MONGO_HOST: 'mongo-test',
      MONGO_PORT: '27017',
      CORE_DB_NAME: 'gastro_core_test',
      CORE_DB_USER: 'gastro_core_svc',
      CORE_DB_PASSWORD: 'local_test_password',
      MONGO_AUTH_SOURCE: 'gastro_core_test',
    });
    expect(dockerCfg.dbName).toBe('gastro_core_test');
    expect(dockerCfg.redactedUri).not.toContain('local_test_password');
  });

  it('defaults to dry-run with zero MongoDB writes and redacts all fixture secrets from diagnostics', async () => {
    const { db, collections } = createLocalMockDb();

    const summary = await executeControlledLocalIngestion({
      rawContent: fixtureRaw,
      source: 'shopeefood',
      batchId: 'm104-dryrun-batch',
      env: safeLocalEnv,
      db,
    });

    expect(summary.mode).toBe('dry-run');
    expect(summary.rawStagedCount).toBe(0);
    expect(summary.plannedInserts).toBe(3);
    expect(summary.metrics.rejected_count).toBe(3);
    expect(summary.metrics.duplicate_count).toBe(1);
    expect(summary.dataQualityReport?.overallQualityStatus).toBe('FAILED');
    expect(
      summary.dataQualityReport?.duplicateCandidates.confirmedDuplicatesCount,
    ).toBe(0);
    expect(summary.dataQualityReport?.duplicateCandidates.intraBatchCount).toBe(
      1,
    );

    // Zero writes to any collection
    expect(collections[RESTAURANTS_COLLECTION].docs).toHaveLength(0);
    expect(collections[RAW_STAGING_COLLECTION].docs).toHaveLength(0);
    expect(collections[INGESTION_BATCHES_COLLECTION].docs).toHaveLength(0);

    // No fixture secrets leak into summary or diagnostics
    const summaryJson = JSON.stringify(summary);
    for (const secret of [
      'fixture-secret-password',
      'fixture-secret-apikey',
      'fixture-jwt-secret',
      'fixture-cookie-secret',
      'fixture-url-pass',
      'fixture-url-token',
    ]) {
      expect(summaryJson).not.toContain(secret);
    }
  });

  it('applies valid records safely to local staging and restaurants, preserves existing user-owned docs, is idempotent on retry, and rolls back cleanly', async () => {
    const existingUserOwnedId = new ObjectId();
    const existingOwnerId = new ObjectId();
    const { db, collections } = createLocalMockDb([
      {
        _id: existingUserOwnedId,
        tenQuan: 'Existing Owner Cafe',
        diaChi: '101 Nguyễn Thị Minh Khai, Q1',
        ownerId: existingOwnerId,
        reviewsCount: 42,
        isVerified: true,
        isFeatured: true,
      },
    ]);

    // 1. Controlled local apply
    const applySummary = await executeControlledLocalIngestion({
      rawContent: fixtureRaw,
      source: 'shopeefood',
      mode: 'apply',
      batchId: 'm104-apply-batch-1',
      env: allowedApplyEnv,
      db,
    });

    expect(applySummary.mode).toBe('apply');
    expect(applySummary.rawStagedCount).toBe(7);
    expect(applySummary.metrics.inserted_count).toBe(3);
    expect(applySummary.metrics.rejected_count).toBe(3);
    expect(applySummary.metrics.duplicate_count).toBe(1);

    // Existing record + 3 valid records = 4 total; rejected records never reached `restaurants`
    expect(collections[RESTAURANTS_COLLECTION].docs).toHaveLength(4);
    expect(collections[RAW_STAGING_COLLECTION].docs).toHaveLength(7);
    expect(collections[INGESTION_BATCHES_COLLECTION].docs).toHaveLength(1);

    const insertedIds = collections[RESTAURANTS_COLLECTION].docs.map(
      (d) => d.externalSourceId,
    );
    expect(insertedIds).toEqual(
      expect.arrayContaining(['m104-sf-1001', 'm104-sf-1002', 'm104-sf-1003']),
    );
    expect(insertedIds).not.toContain('m104-sf-bad-rating');
    expect(insertedIds).not.toContain('m104-sf-bad-reviews');
    expect(insertedIds).not.toContain('m104-sf-bad-url');

    // 2. Reusing same batchId is refused
    await expect(
      executeControlledLocalIngestion({
        rawContent: fixtureRaw,
        source: 'shopeefood',
        mode: 'apply',
        batchId: 'm104-apply-batch-1',
        env: allowedApplyEnv,
        db,
      }),
    ).rejects.toThrow(IngestionValidationError);

    // 3. Retry with new batchId is idempotent (0 new inserts, matches existing 3 records)
    const retrySummary = await executeControlledLocalIngestion({
      rawContent: fixtureRaw,
      source: 'shopeefood',
      mode: 'apply',
      batchId: 'm104-apply-batch-2',
      env: allowedApplyEnv,
      db,
    });
    expect(retrySummary.metrics.inserted_count).toBe(0);
    expect(retrySummary.metrics.matched_count).toBe(3);
    expect(collections[RESTAURANTS_COLLECTION].docs).toHaveLength(4);

    // 4. LIFO rollback removes batch-2 updates then batch-1 inserts while keeping pre-existing owner doc intact
    const rb2 = await rollbackIngestionBatch(db, 'm104-apply-batch-2', {
      dryRun: false,
    });
    expect(rb2.status).toBe('rolled_back');

    const rb1 = await rollbackIngestionBatch(db, 'm104-apply-batch-1', {
      dryRun: false,
    });
    expect(rb1.status).toBe('rolled_back');
    expect(rb1.deletedInsertedCount).toBe(3);
    expect(collections[RESTAURANTS_COLLECTION].docs).toHaveLength(1);
    expect(String(collections[RESTAURANTS_COLLECTION].docs[0]._id)).toBe(
      existingUserOwnedId.toString(),
    );
    expect(collections[RESTAURANTS_COLLECTION].docs[0].reviewsCount).toBe(42);
    expect(collections[RESTAURANTS_COLLECTION].docs[0].isVerified).toBe(true);
  });

  it('parses --source flag in ingestion CLI args', () => {
    const parsed = parseIngestionCliArgs([
      '--file=scripts/ingestion/fixtures/m10_4_shopeefood_local_fixture.json',
      '--source=shopeefood',
    ]);
    expect(parsed.mode).toBe('dry-run');
    expect(parsed.dryRun).toBe(true);
    expect(parsed.source).toBe('shopeefood');
  });
});
