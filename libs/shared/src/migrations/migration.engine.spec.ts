import type { Db } from 'mongodb';
import {
  DuplicateMigrationError,
  IncompleteMigrationError,
  IrreversibleMigrationError,
  JsonMigrationLogger,
  MigrationDefinition,
  MigrationEngine,
  MigrationLockError,
  MigrationLockManager,
  MigrationRegistry,
  MigrationValidationError,
  parseMigrationCliArgs,
  redactSensitiveString,
  resolveDatabaseConnectionConfig,
} from './index';

type Doc = Record<string, unknown>;

function toSortValue(value: unknown): string | number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' || typeof value === 'number') return value;
  return '';
}

function cloneDoc<T>(val: T): T {
  if (val === null || typeof val !== 'object') return val;
  if (Object.prototype.toString.call(val) === '[object Date]') {
    return new Date((val as unknown as Date).getTime()) as unknown as T;
  }
  if (Array.isArray(val)) {
    const items = (val as unknown[]).map((item) => cloneDoc<unknown>(item));
    return items as unknown as T;
  }
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(val)) {
    copy[k] = cloneDoc<unknown>(v);
  }
  return copy as T;
}

class InMemoryMongoCollection {
  private readonly docs = new Map<string, Doc>();
  public readonly createdIndexes: Array<{
    key: Record<string, number>;
    options: Record<string, unknown>;
  }> = [];

  createIndex(
    key: Record<string, number>,
    options: Record<string, unknown> = {},
  ): Promise<string> {
    this.createdIndexes.push({ key, options });
    return Promise.resolve(
      typeof options.name === 'string' ? options.name : 'idx',
    );
  }

  findOne(filter: Doc): Promise<Doc | null> {
    for (const doc of this.docs.values()) {
      if (this.matches(doc, filter)) {
        return Promise.resolve(cloneDoc(doc));
      }
    }
    return Promise.resolve(null);
  }

  find(filter: Doc) {
    const matched = Array.from(this.docs.values())
      .filter((d) => this.matches(d, filter))
      .map((d) => cloneDoc(d));

    return {
      sort: (sortSpec: Record<string, 1 | -1>) => ({
        toArray: () => {
          const [[field, dir]] = Object.entries(sortSpec);
          const sorted = [...matched].sort((a, b) => {
            const va = toSortValue(a[field]);
            const vb = toSortValue(b[field]);
            if (va < vb) return -1 * dir;
            if (va > vb) return 1 * dir;
            return 0;
          });
          return Promise.resolve(sorted);
        },
      }),
      toArray: () => Promise.resolve(matched),
    };
  }

  insertOne(doc: Doc): Promise<{ acknowledged: boolean; insertedId: unknown }> {
    const idKey = String(doc._id);
    if (this.docs.has(idKey)) {
      const err = new Error(
        `E11000 duplicate key error _id: ${idKey}`,
      ) as Error & {
        code: number;
      };
      err.code = 11000;
      return Promise.reject(err);
    }
    this.docs.set(idKey, cloneDoc(doc));
    return Promise.resolve({ acknowledged: true, insertedId: doc._id });
  }

  findOneAndUpdate(filter: Doc, update: { $set?: Doc }): Promise<Doc | null> {
    for (const [key, doc] of this.docs.entries()) {
      if (this.matches(doc, filter)) {
        const next = { ...doc, ...(update.$set ?? {}) };
        this.docs.set(key, next);
        return Promise.resolve(cloneDoc(next));
      }
    }
    return Promise.resolve(null);
  }

  updateOne(
    filter: Doc,
    update: { $set?: Doc },
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    for (const [key, doc] of this.docs.entries()) {
      if (this.matches(doc, filter)) {
        this.docs.set(key, { ...doc, ...(update.$set ?? {}) });
        return Promise.resolve({ matchedCount: 1, modifiedCount: 1 });
      }
    }
    return Promise.resolve({ matchedCount: 0, modifiedCount: 0 });
  }

  deleteOne(filter: Doc): Promise<{ deletedCount: number }> {
    for (const [key, doc] of this.docs.entries()) {
      if (this.matches(doc, filter)) {
        this.docs.delete(key);
        return Promise.resolve({ deletedCount: 1 });
      }
    }
    return Promise.resolve({ deletedCount: 0 });
  }

  private matches(doc: Doc, filter: Doc): boolean {
    for (const [k, cond] of Object.entries(filter)) {
      const val = doc[k];
      if (
        cond &&
        typeof cond === 'object' &&
        !(cond instanceof Date) &&
        '$lte' in cond
      ) {
        const target = (cond as { $lte: Date }).$lte;
        if (!(val instanceof Date) || val.getTime() > target.getTime()) {
          return false;
        }
      } else if (val !== cond) {
        return false;
      }
    }
    return true;
  }
}

class InMemoryMongoDb {
  private readonly cols = new Map<string, InMemoryMongoCollection>();

  collection(name: string): InMemoryMongoCollection {
    let col = this.cols.get(name);
    if (!col) {
      col = new InMemoryMongoCollection();
      this.cols.set(name, col);
    }
    return col;
  }

  asDb(): Db {
    return this as unknown as Db;
  }
}

function makeMigration(
  overrides: Partial<MigrationDefinition> = {},
): MigrationDefinition {
  return {
    id: '20261126001_init_fixture',
    version: '001',
    name: 'Initialize synthetic collection',
    database: 'core',
    idempotency: 'idempotent',
    reversible: true,
    up: () => Promise.resolve(),
    down: () => Promise.resolve(),
    ...overrides,
  };
}

describe('M9.1 Versioned TypeScript MongoDB Migration Runner', () => {
  const silentLogger = new JsonMigrationLogger(true);

  describe('1-3 & 12. Registry Discovery, Deterministic Ordering, Duplicates & Metadata Validation', () => {
    it('discovers and deterministically sorts migrations by numeric/dotted version within scope', () => {
      const m10 = makeMigration({
        id: 'm10',
        version: '10',
        name: 'Tenth migration',
      });
      const m2 = makeMigration({
        id: 'm2',
        version: '002',
        name: 'Second migration',
      });
      const m1 = makeMigration({
        id: 'm1',
        version: 'V001',
        name: 'First migration',
      });
      const mPlanning = makeMigration({
        id: 'p1',
        version: '001',
        name: 'Planning migration',
        database: 'planning',
      });

      const registry = new MigrationRegistry([m10, m2, mPlanning, m1]);
      expect(registry.getAll('core').map((m) => m.id)).toEqual([
        'm1',
        'm2',
        'm10',
      ]);
      expect(registry.getAll('planning').map((m) => m.id)).toEqual(['p1']);
    });

    it('detects duplicate migration IDs and duplicate versions within the same scope', () => {
      const m1 = makeMigration({ id: 'dup_id', version: '001' });
      expect(() => new MigrationRegistry([m1, m1])).toThrow(
        DuplicateMigrationError,
      );

      const m2SameVersion = makeMigration({ id: 'different_id', version: '1' });
      expect(() => new MigrationRegistry([m1, m2SameVersion])).toThrow(
        DuplicateMigrationError,
      );
    });

    it('rejects invalid migration metadata (bad version, reversible without down, irreversible with down)', () => {
      expect(
        () =>
          new MigrationRegistry([makeMigration({ version: 'not-a-version' })]),
      ).toThrow(MigrationValidationError);

      expect(
        () =>
          new MigrationRegistry([
            makeMigration({ reversible: true, down: undefined }),
          ]),
      ).toThrow(MigrationValidationError);

      expect(
        () =>
          new MigrationRegistry([
            makeMigration({
              reversible: false,
              down: () => Promise.resolve(),
            }),
          ]),
      ).toThrow(MigrationValidationError);
    });
  });

  describe('4, 5 & 11. Execution, Skipping Applied & Migration History Persistence', () => {
    it('executes pending migrations in order, persists history metadata, and skips previously applied runs', async () => {
      const memDb = new InMemoryMongoDb();
      const db = memDb.asDb();
      const callOrder: string[] = [];

      const registry = new MigrationRegistry([
        makeMigration({
          id: '002_second',
          version: '002',
          name: 'Second synthetic step',
          up: async ({ db: targetDb }) => {
            callOrder.push('002_second');
            await targetDb
              .collection<{ _id: string; ok: boolean }>('fixtures')
              .insertOne({ _id: 'f2', ok: true });
          },
        }),
        makeMigration({
          id: '001_first',
          version: '001',
          name: 'First synthetic step',
          up: async ({ db: targetDb }) => {
            callOrder.push('001_first');
            await targetDb
              .collection<{ _id: string; ok: boolean }>('fixtures')
              .insertOne({ _id: 'f1', ok: true });
          },
        }),
      ]);

      const engine = new MigrationEngine(db, registry, {
        logger: silentLogger,
        runnerId: 'runner-test-1',
      });

      const firstRun = await engine.up({ scope: 'core' });
      expect(firstRun.executed.map((e) => e.id)).toEqual([
        '001_first',
        '002_second',
      ]);
      expect(callOrder).toEqual(['001_first', '002_second']);

      const hist1 = await memDb
        .collection('schema_migrations')
        .findOne({ _id: '001_first' });
      expect(hist1?.status).toBe('applied');
      expect(hist1?.startedAt).toBeInstanceOf(Date);
      expect(hist1?.completedAt).toBeInstanceOf(Date);
      expect(typeof hist1?.durationMs).toBe('number');
      expect(hist1?.checksum).toMatch(/^[a-f0-9]{64}$/);

      // Second execution must skip already-applied migrations cleanly
      const secondRun = await engine.up({ scope: 'core' });
      expect(secondRun.executed).toEqual([]);
      expect(secondRun.skippedAlreadyApplied).toEqual([
        '001_first',
        '002_second',
      ]);
      expect(callOrder).toEqual(['001_first', '002_second']);

      const status = await engine.status('core');
      expect(status.applied).toHaveLength(2);
      expect(status.pending).toHaveLength(0);
    });
  });

  describe('6, 7 & 9. Failure Recording, Incomplete Detection & Idempotency Guard', () => {
    it('records failed migration errors and refuses automatic retry of non_idempotent failures', async () => {
      const memDb = new InMemoryMongoDb();
      const db = memDb.asDb();

      const nonIdempotentFail = makeMigration({
        id: '001_fail_non_idempotent',
        version: '001',
        name: 'Failing non-idempotent migration',
        idempotency: 'non_idempotent',
        up: () =>
          Promise.reject(
            new Error('mongodb://user:secretpass@cluster0.example.net failure'),
          ),
      });

      const registry = new MigrationRegistry([nonIdempotentFail]);
      const engine = new MigrationEngine(db, registry, {
        logger: silentLogger,
      });

      await expect(engine.up({ scope: 'core' })).rejects.toThrow('failure');

      const failedRec = await memDb
        .collection('schema_migrations')
        .findOne({ _id: '001_fail_non_idempotent' });
      expect(failedRec?.status).toBe('failed');
      // Secret redaction check in stored error metadata
      const errObj = failedRec?.error as { message: string };
      expect(errObj.message).not.toContain('secretpass');
      expect(errObj.message).toContain('mongodb://user:***@');

      // Even with retryFailedIdempotent=true, non_idempotent must NEVER auto-retry
      await expect(
        engine.up({ scope: 'core', retryFailedIdempotent: true }),
      ).rejects.toThrow(IncompleteMigrationError);
    });

    it('detects incomplete "running" execution and blocks subsequent runs', async () => {
      const memDb = new InMemoryMongoDb();
      const db = memDb.asDb();

      await memDb.collection('schema_migrations').insertOne({
        _id: '001_crashed',
        version: '001',
        name: 'Crashed halfway',
        database: 'core',
        status: 'running',
        startedAt: new Date(),
        completedAt: null,
        durationMs: null,
        runnerId: 'dead-pod',
        error: null,
      });

      const registry = new MigrationRegistry([
        makeMigration({ id: '001_crashed', version: '001' }),
      ]);
      const engine = new MigrationEngine(db, registry, {
        logger: silentLogger,
      });

      await expect(engine.up({ scope: 'core' })).rejects.toThrow(
        IncompleteMigrationError,
      );
    });

    it('allows explicit retry of failed idempotent migrations when requested', async () => {
      const memDb = new InMemoryMongoDb();
      const db = memDb.asDb();
      let attempts = 0;

      const flakyIdempotent = makeMigration({
        id: '001_idempotent_flaky',
        version: '001',
        name: 'Idempotent migration recovering on retry',
        idempotency: 'idempotent',
        up: () => {
          attempts++;
          if (attempts === 1) {
            return Promise.reject(new Error('Transient network blip'));
          }
          return Promise.resolve();
        },
      });

      const registry = new MigrationRegistry([flakyIdempotent]);
      const engine = new MigrationEngine(db, registry, {
        logger: silentLogger,
      });

      await expect(engine.up({ scope: 'core' })).rejects.toThrow('Transient');
      await expect(engine.up({ scope: 'core' })).rejects.toThrow(
        IncompleteMigrationError,
      );

      const retried = await engine.up({
        scope: 'core',
        retryFailedIdempotent: true,
      });
      expect(retried.executed.map((e) => e.id)).toEqual([
        '001_idempotent_flaky',
      ]);
      const rec = await memDb
        .collection('schema_migrations')
        .findOne({ _id: '001_idempotent_flaky' });
      expect(rec?.status).toBe('applied');
    });
  });

  describe('8. Concurrency Lock Protection & Stale Lock Recovery', () => {
    it('prevents concurrent runners from holding the same scope lock and recovers expired stale locks', async () => {
      const memDb = new InMemoryMongoDb();
      const lockMgr = new MigrationLockManager(memDb.asDb(), silentLogger);

      await lockMgr.acquire('core', 'runner-A', 60_000);
      await expect(lockMgr.acquire('core', 'runner-B', 60_000)).rejects.toThrow(
        MigrationLockError,
      );

      // Releasing with wrong owner must NOT remove runner-A's lock
      await lockMgr.release('core', 'runner-B');
      await expect(lockMgr.acquire('core', 'runner-B', 60_000)).rejects.toThrow(
        MigrationLockError,
      );

      // Clean release lets runner-B acquire
      await lockMgr.release('core', 'runner-A');
      const acquiredB = await lockMgr.acquire('core', 'runner-B', 1);

      // Wait 5ms so acquiredB becomes expired stale lock, then runner-C recovers it atomically
      await new Promise((r) => setTimeout(r, 10));
      expect(acquiredB.ownerId).toBe('runner-B');
      const recoveredC = await lockMgr.acquire('core', 'runner-C', 60_000);
      expect(recoveredC.ownerId).toBe('runner-C');
    });
  });

  describe('10. Reverse-Order Rollback & Irreversible Guard', () => {
    it('executes reversible down() handlers in reverse version order and blocks irreversible rollbacks', async () => {
      const memDb = new InMemoryMongoDb();
      const db = memDb.asDb();
      const events: string[] = [];

      const m1 = makeMigration({
        id: '001_irreversible',
        version: '001',
        name: 'Destructive dedup',
        reversible: false,
        down: undefined,
        up: () => {
          events.push('up:001');
          return Promise.resolve();
        },
      });
      const m2 = makeMigration({
        id: '002_reversible',
        version: '002',
        name: 'Additive index',
        reversible: true,
        up: () => {
          events.push('up:002');
          return Promise.resolve();
        },
        down: () => {
          events.push('down:002');
          return Promise.resolve();
        },
      });
      const m3 = makeMigration({
        id: '003_reversible',
        version: '003',
        name: 'Additive field',
        reversible: true,
        up: () => {
          events.push('up:003');
          return Promise.resolve();
        },
        down: () => {
          events.push('down:003');
          return Promise.resolve();
        },
      });

      const engine = new MigrationEngine(
        db,
        new MigrationRegistry([m1, m2, m3]),
        { logger: silentLogger },
      );

      await engine.up({ scope: 'core' });

      // Trying to roll back 3 steps hits m1 (irreversible) during pre-check and refuses BEFORE running any down()
      await expect(engine.down({ scope: 'core', steps: 3 })).rejects.toThrow(
        IrreversibleMigrationError,
      );
      expect(events).toEqual(['up:001', 'up:002', 'up:003']);

      // Rolling back top 2 reversible migrations succeeds in exact reverse order (003 then 002)
      const rb = await engine.down({ scope: 'core', steps: 2 });
      expect(rb.rolledBack.map((r) => r.id)).toEqual([
        '003_reversible',
        '002_reversible',
      ]);
      expect(events).toEqual([
        'up:001',
        'up:002',
        'up:003',
        'down:003',
        'down:002',
      ]);

      const rec3 = await memDb
        .collection('schema_migrations')
        .findOne({ _id: '003_reversible' });
      expect(rec3?.status).toBe('rolled_back');
    });
  });

  describe('Security, Boundary Resolution & CLI Arg Parsing', () => {
    it('redacts credentials in Mongo URIs and resolves isolated DB boundaries from env', () => {
      const redacted = redactSensitiveString(
        'mongodb+srv://adminUser:SuperSecret123@cluster0.mongodb.net/gastro_core',
      );
      expect(redacted).toBe(
        'mongodb+srv://adminUser:***@cluster0.mongodb.net/gastro_core',
      );

      const coreCfg = resolveDatabaseConnectionConfig('core', {
        MONGODB_URI_CORE: 'mongodb://mongo:27017/gastro_core_staging',
        CORE_DB_NAME: 'gastro_core_staging',
      });
      expect(coreCfg.dbName).toBe('gastro_core_staging');

      const planningCfg = resolveDatabaseConnectionConfig('planning', {
        MONGODB_URI_PLANNING: 'mongodb://mongo:27017/gastro_planning_staging',
        PLANNING_DB_NAME: 'gastro_planning_staging',
      });
      expect(planningCfg.dbName).toBe('gastro_planning_staging');
    });

    it('rejects passing --uri or --password via CLI flags to prevent credential exposure', () => {
      expect(() =>
        parseMigrationCliArgs([
          'up',
          '--scope=core',
          '--uri=mongodb://user:pass@host/db',
        ]),
      ).toThrow(MigrationValidationError);

      const ok = parseMigrationCliArgs(['up', '--scope=planning', '--dry-run']);
      expect(ok).toEqual({
        command: 'up',
        scope: 'planning',
        targetId: undefined,
        steps: undefined,
        dryRun: true,
        retryFailedIdempotent: false,
        allowAtlas: false,
      });

      const withAtlasFlag = parseMigrationCliArgs([
        'up',
        '--scope=core',
        '--dry-run',
        '--allow-atlas',
      ]);
      expect(withAtlasFlag.allowAtlas).toBe(true);
    });

    it('rejects Atlas mongodb+srv:// and mongodb.net targets by default without exposing credentials', () => {
      const srvUri =
        'mongodb+srv://atlasUser:TopSecretPass99@cluster0.abcde.mongodb.net/gastro_core';
      let caughtSrv: unknown;
      try {
        resolveDatabaseConnectionConfig('core', {
          MONGODB_URI_CORE: srvUri,
        });
      } catch (err: unknown) {
        caughtSrv = err;
      }
      expect(caughtSrv).toBeInstanceOf(MigrationValidationError);
      const srvMsg = (caughtSrv as Error).message;
      expect(srvMsg).toContain('ALLOW_ATLAS_MIGRATION=true');
      expect(srvMsg).not.toContain('TopSecretPass99');
      expect(srvMsg).toContain('atlasUser:***@');

      const hostUri =
        'mongodb://atlasUser:AnotherSecret88@shard0.xyz.mongodb.net:27017/gastro_planning';
      let caughtHost: unknown;
      try {
        resolveDatabaseConnectionConfig('planning', {
          MONGODB_URI_PLANNING: hostUri,
        });
      } catch (err: unknown) {
        caughtHost = err;
      }
      expect(caughtHost).toBeInstanceOf(MigrationValidationError);
      expect((caughtHost as Error).message).not.toContain('AnotherSecret88');
    });

    it('allows Atlas targets when ALLOW_ATLAS_MIGRATION=true or --allow-atlas is explicitly provided', () => {
      const srvUri =
        'mongodb+srv://atlasUser:TopSecretPass99@cluster0.abcde.mongodb.net/gastro_core';

      const envAuthorized = resolveDatabaseConnectionConfig('core', {
        MONGODB_URI_CORE: srvUri,
        ALLOW_ATLAS_MIGRATION: 'true',
      });
      expect(envAuthorized.atlasAuthorized).toBe(true);
      expect(envAuthorized.redactedUri).not.toContain('TopSecretPass99');

      const flagAuthorized = resolveDatabaseConnectionConfig(
        'core',
        { MONGODB_URI_CORE: srvUri },
        { allowAtlas: true },
      );
      expect(flagAuthorized.atlasAuthorized).toBe(true);
    });

    it('allows localhost and Docker service hostnames without Atlas authorization', () => {
      const localhostCfg = resolveDatabaseConnectionConfig('core', {
        MONGODB_URI_CORE: 'mongodb://localhost:27017/gastro_core_test',
      });
      expect(localhostCfg.atlasAuthorized).toBe(false);

      const loopbackCfg = resolveDatabaseConnectionConfig('core', {
        MONGODB_URI_CORE: 'mongodb://127.0.0.1:27017/gastro_core_test',
      });
      expect(loopbackCfg.atlasAuthorized).toBe(false);

      const dockerCfg = resolveDatabaseConnectionConfig('planning', {
        MONGODB_URI_PLANNING:
          'mongodb://gastro_planning_svc:testpass@mongo-test:27017/gastro_planning_test',
      });
      expect(dockerCfg.atlasAuthorized).toBe(false);
    });

    it('fails safely on missing URIs and ambiguous or malformed remote targets', () => {
      expect(() => resolveDatabaseConnectionConfig('core', {})).toThrow(
        MigrationValidationError,
      );

      expect(() =>
        resolveDatabaseConnectionConfig('core', {
          MONGODB_URI_CORE:
            'mongodb://user:SecretAmbiguous@db.external-host.example.com:27017/gastro_core',
        }),
      ).toThrow(MigrationValidationError);

      expect(() =>
        resolveDatabaseConnectionConfig('core', {
          MONGODB_URI_CORE: 'not-a-valid-mongo-uri',
          ALLOW_ATLAS_MIGRATION: 'true',
        }),
      ).toThrow(MigrationValidationError);
    });
  });
});
