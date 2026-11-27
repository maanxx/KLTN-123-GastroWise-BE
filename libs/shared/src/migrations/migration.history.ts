import type { Collection, Db } from 'mongodb';
import {
  IncompleteMigrationError,
  MigrationDatabaseScope,
  MigrationDefinition,
  MigrationErrorRecord,
  MigrationHistoryDocument,
  redactSensitiveString,
} from './migration.types';

export const MIGRATION_HISTORY_COLLECTION = 'schema_migrations';

export function serializeMigrationError(err: unknown): MigrationErrorRecord {
  if (err instanceof Error) {
    const code = (err as Error & { code?: string | number }).code;
    return {
      name: err.name,
      message: redactSensitiveString(err.message),
      ...(code !== undefined ? { code } : {}),
      stack: err.stack ? redactSensitiveString(err.stack) : undefined,
    };
  }
  return {
    message: redactSensitiveString(String(err)),
  };
}

export class MigrationHistoryStore {
  private readonly collection: Collection<MigrationHistoryDocument>;

  constructor(db: Db) {
    this.collection = db.collection<MigrationHistoryDocument>(
      MIGRATION_HISTORY_COLLECTION,
    );
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex(
      { version: 1, database: 1 },
      { unique: true, name: 'uniq_version_database', background: true },
    );
    await this.collection.createIndex(
      { database: 1, status: 1, startedAt: -1 },
      { name: 'idx_database_status_started', background: true },
    );
  }

  async getByScope(
    scope: MigrationDatabaseScope,
  ): Promise<MigrationHistoryDocument[]> {
    return this.collection
      .find({ database: scope })
      .sort({ startedAt: 1 })
      .toArray();
  }

  async getById(id: string): Promise<MigrationHistoryDocument | null> {
    return this.collection.findOne({ _id: id });
  }

  async beginExecution(
    migration: MigrationDefinition,
    checksum: string,
    runnerId: string,
    options: { retryFailedIdempotent?: boolean } = {},
  ): Promise<{ alreadyApplied: boolean; startedAt: Date }> {
    const existing = await this.getById(migration.id);
    const now = new Date();

    if (existing) {
      if (existing.status === 'applied') {
        return { alreadyApplied: true, startedAt: existing.startedAt };
      }

      if (existing.status === 'running') {
        throw new IncompleteMigrationError(
          `Migration "${migration.id}" has an incomplete "running" execution started at ${existing.startedAt.toISOString()} by runner "${existing.runnerId}". Automatic rerun is blocked to prevent corruption.`,
        );
      }

      if (existing.status === 'failed') {
        const canRetry =
          options.retryFailedIdempotent === true &&
          migration.idempotency === 'idempotent';
        if (!canRetry) {
          throw new IncompleteMigrationError(
            `Migration "${migration.id}" previously failed (${existing.error?.message ?? 'unknown error'}). Non-idempotent or unapproved failed migrations cannot be automatically rerun.`,
          );
        }

        const updated = await this.collection.findOneAndUpdate(
          { _id: migration.id, status: 'failed' },
          {
            $set: {
              status: 'running',
              startedAt: now,
              completedAt: null,
              durationMs: null,
              runnerId,
              checksum,
              error: null,
            },
          },
          { returnDocument: 'after' },
        );
        const doc = this.unwrapFindAndUpdate(updated);
        if (!doc || doc.status !== 'running') {
          throw new IncompleteMigrationError(
            `Failed to transition failed migration "${migration.id}" to running state.`,
          );
        }
        return { alreadyApplied: false, startedAt: now };
      }

      if (existing.status === 'rolled_back') {
        const updated = await this.collection.findOneAndUpdate(
          { _id: migration.id, status: 'rolled_back' },
          {
            $set: {
              status: 'running',
              startedAt: now,
              completedAt: null,
              durationMs: null,
              runnerId,
              checksum,
              error: null,
            },
          },
          { returnDocument: 'after' },
        );
        const doc = this.unwrapFindAndUpdate(updated);
        if (!doc || doc.status !== 'running') {
          throw new IncompleteMigrationError(
            `Failed to re-acquire rolled_back migration "${migration.id}" for execution.`,
          );
        }
        return { alreadyApplied: false, startedAt: now };
      }
    }

    await this.collection.insertOne({
      _id: migration.id,
      version: migration.version,
      name: migration.name,
      database: migration.database,
      checksum,
      idempotency: migration.idempotency,
      reversible: migration.reversible,
      status: 'running',
      startedAt: now,
      completedAt: null,
      durationMs: null,
      runnerId,
      error: null,
    });

    return { alreadyApplied: false, startedAt: now };
  }

  async markApplied(id: string, startedAt: Date): Promise<number> {
    const completedAt = new Date();
    const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());
    await this.collection.updateOne(
      { _id: id },
      {
        $set: {
          status: 'applied',
          completedAt,
          durationMs,
          error: null,
        },
      },
    );
    return durationMs;
  }

  async markFailed(
    id: string,
    startedAt: Date,
    error: unknown,
  ): Promise<number> {
    const completedAt = new Date();
    const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());
    await this.collection.updateOne(
      { _id: id },
      {
        $set: {
          status: 'failed',
          completedAt,
          durationMs,
          error: serializeMigrationError(error),
        },
      },
    );
    return durationMs;
  }

  async markRolledBack(id: string, startedAt: Date): Promise<number> {
    const completedAt = new Date();
    const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());
    await this.collection.updateOne(
      { _id: id },
      {
        $set: {
          status: 'rolled_back',
          completedAt,
          durationMs,
          error: null,
        },
      },
    );
    return durationMs;
  }

  private unwrapFindAndUpdate(
    res:
      | MigrationHistoryDocument
      | { value?: MigrationHistoryDocument | null }
      | null,
  ): MigrationHistoryDocument | null {
    if (!res) return null;
    if ('value' in res && !('_id' in res)) {
      return res.value ?? null;
    }
    return res as MigrationHistoryDocument;
  }
}
