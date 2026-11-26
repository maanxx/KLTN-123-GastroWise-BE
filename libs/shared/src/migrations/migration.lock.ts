import * as os from 'os';
import type { Collection, Db } from 'mongodb';
import {
  MigrationDatabaseScope,
  MigrationLockDocument,
  MigrationLockError,
  MigrationLogger,
} from './migration.types';

export const MIGRATION_LOCK_COLLECTION = 'schema_migration_locks';
export const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000;

function isDuplicateKeyError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: number }).code;
  return code === 11000;
}

export class MigrationLockManager {
  private readonly collection: Collection<MigrationLockDocument>;

  constructor(
    db: Db,
    private readonly logger: MigrationLogger,
  ) {
    this.collection = db.collection<MigrationLockDocument>(
      MIGRATION_LOCK_COLLECTION,
    );
  }

  static lockIdForScope(scope: MigrationDatabaseScope): string {
    return `migration_lock:${scope}`;
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'lock_expires_ttl', background: true },
    );
  }

  async getActiveLock(
    scope: MigrationDatabaseScope,
  ): Promise<MigrationLockDocument | null> {
    const lock = await this.collection.findOne({
      _id: MigrationLockManager.lockIdForScope(scope),
    });
    if (!lock) return null;
    if (lock.expiresAt.getTime() <= Date.now()) {
      return null;
    }
    return lock;
  }

  async acquire(
    scope: MigrationDatabaseScope,
    ownerId: string,
    ttlMs: number = DEFAULT_LOCK_TTL_MS,
  ): Promise<MigrationLockDocument> {
    const lockId = MigrationLockManager.lockIdForScope(scope);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    const doc: MigrationLockDocument = {
      _id: lockId,
      ownerId,
      scope,
      acquiredAt: now,
      expiresAt,
      pid: process.pid,
      hostname: os.hostname(),
    };

    try {
      await this.collection.insertOne(doc);
      this.logger.info('lock_acquired', {
        scope,
        details: { ownerId, expiresAt: expiresAt.toISOString() },
      });
      return doc;
    } catch (err) {
      if (!isDuplicateKeyError(err)) {
        throw err;
      }

      // Attempt atomic stale-lock takeover strictly if expiresAt <= now
      const recovered = await this.collection.findOneAndUpdate(
        { _id: lockId, expiresAt: { $lte: now } },
        {
          $set: {
            ownerId,
            scope,
            acquiredAt: now,
            expiresAt,
            pid: doc.pid,
            hostname: doc.hostname,
          },
        },
        { returnDocument: 'after' },
      );
      const recoveredDoc =
        recovered &&
        typeof recovered === 'object' &&
        'value' in recovered &&
        !('_id' in recovered)
          ? ((recovered as { value?: MigrationLockDocument | null }).value ??
            null)
          : (recovered as MigrationLockDocument | null);

      if (recoveredDoc && recoveredDoc.ownerId === ownerId) {
        this.logger.warn('stale_lock_recovered', {
          scope,
          details: { ownerId, expiresAt: expiresAt.toISOString() },
        });
        return recoveredDoc;
      }

      const active = await this.collection.findOne({ _id: lockId });
      throw new MigrationLockError(
        `Concurrent migration lock active for "${scope}" (held by "${active?.ownerId ?? 'unknown'}" until ${active?.expiresAt?.toISOString() ?? 'unknown'}).`,
      );
    }
  }

  async release(scope: MigrationDatabaseScope, ownerId: string): Promise<void> {
    const lockId = MigrationLockManager.lockIdForScope(scope);
    const result = await this.collection.deleteOne({ _id: lockId, ownerId });
    this.logger.info('lock_released', {
      scope,
      details: { ownerId, deletedCount: result.deletedCount },
    });
  }
}
