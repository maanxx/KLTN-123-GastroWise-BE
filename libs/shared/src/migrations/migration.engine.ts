import { randomUUID } from 'crypto';
import type { Db } from 'mongodb';
import { MigrationHistoryStore } from './migration.history';
import { DEFAULT_LOCK_TTL_MS, MigrationLockManager } from './migration.lock';
import {
  computeMigrationChecksum,
  MigrationRegistry,
} from './migration.registry';
import {
  IncompleteMigrationError,
  IrreversibleMigrationError,
  JsonMigrationLogger,
  MigrationContext,
  MigrationDatabaseScope,
  MigrationDefinition,
  MigrationHistoryDocument,
  MigrationLockDocument,
  MigrationLogger,
  MigrationValidationError,
} from './migration.types';

export interface MigrationStatusReport {
  scope: MigrationDatabaseScope;
  totalRegistered: number;
  applied: MigrationHistoryDocument[];
  pending: MigrationDefinition[];
  incompleteOrFailed: MigrationHistoryDocument[];
  activeLock: MigrationLockDocument | null;
}

export interface RunMigrationsOptions {
  scope: MigrationDatabaseScope;
  targetId?: string;
  dryRun?: boolean;
  retryFailedIdempotent?: boolean;
  lockTtlMs?: number;
}

export interface RunMigrationsResult {
  scope: MigrationDatabaseScope;
  dryRun: boolean;
  executed: Array<{ id: string; version: string; durationMs: number }>;
  skippedAlreadyApplied: string[];
  plannedForDryRun: string[];
}

export interface RollbackMigrationsOptions {
  scope: MigrationDatabaseScope;
  steps?: number;
  migrationId?: string;
  dryRun?: boolean;
  lockTtlMs?: number;
}

export interface RollbackMigrationsResult {
  scope: MigrationDatabaseScope;
  dryRun: boolean;
  rolledBack: Array<{ id: string; version: string; durationMs: number }>;
  plannedForDryRun: string[];
}

export class MigrationEngine {
  private readonly historyStore: MigrationHistoryStore;
  private readonly lockManager: MigrationLockManager;
  private readonly logger: MigrationLogger;
  private readonly runnerId: string;

  constructor(
    private readonly db: Db,
    private readonly registry: MigrationRegistry,
    options: { logger?: MigrationLogger; runnerId?: string } = {},
  ) {
    this.logger = options.logger ?? new JsonMigrationLogger();
    this.runnerId = options.runnerId ?? `runner_${randomUUID()}`;
    this.historyStore = new MigrationHistoryStore(db);
    this.lockManager = new MigrationLockManager(db, this.logger);
  }

  async initialize(): Promise<void> {
    await this.historyStore.ensureIndexes();
    await this.lockManager.ensureIndexes();
  }

  async status(scope: MigrationDatabaseScope): Promise<MigrationStatusReport> {
    const registered = this.registry.getAll(scope);
    const history = await this.historyStore.getByScope(scope);
    const historyMap = new Map(history.map((h) => [h._id, h]));

    const applied: MigrationHistoryDocument[] = [];
    const incompleteOrFailed: MigrationHistoryDocument[] = [];
    const pending: MigrationDefinition[] = [];

    for (const h of history) {
      if (h.status === 'applied') {
        applied.push(h);
      } else if (h.status === 'running' || h.status === 'failed') {
        incompleteOrFailed.push(h);
      }
    }

    for (const migration of registered) {
      const rec = historyMap.get(migration.id);
      if (!rec || rec.status === 'rolled_back') {
        pending.push(migration);
      }
    }

    const activeLock = await this.lockManager.getActiveLock(scope);

    return {
      scope,
      totalRegistered: registered.length,
      applied,
      pending,
      incompleteOrFailed,
      activeLock,
    };
  }

  async up(options: RunMigrationsOptions): Promise<RunMigrationsResult> {
    const {
      scope,
      targetId,
      dryRun = false,
      retryFailedIdempotent = false,
      lockTtlMs = DEFAULT_LOCK_TTL_MS,
    } = options;

    const registered = this.registry.getAll(scope);
    this.logger.info('migration_discovery', {
      scope,
      details: {
        totalRegistered: registered.length,
        targetId: targetId ?? null,
      },
    });

    if (targetId) {
      const target = this.registry.getById(targetId);
      if (!target || target.database !== scope) {
        throw new MigrationValidationError(
          `Migration "${targetId}" is not registered under scope "${scope}".`,
        );
      }
    }

    if (!dryRun) {
      await this.initialize();
    }

    const history = await this.historyStore.getByScope(scope);
    const historyMap = new Map(history.map((h) => [h._id, h]));

    // Block immediately on any incomplete ("running") migration
    const runningEntries = history.filter((h) => h.status === 'running');
    if (runningEntries.length > 0) {
      const ids = runningEntries.map((h) => h._id).join(', ');
      throw new IncompleteMigrationError(
        `Detected incomplete "running" migration(s) in "${scope}": ${ids}. Manual verification is required before running further migrations.`,
      );
    }

    // Block on failed migrations unless retryFailedIdempotent is enabled AND every failed one is idempotent
    const failedEntries = history.filter((h) => h.status === 'failed');
    for (const failed of failedEntries) {
      const def = this.registry.getById(failed._id);
      const safeToRetry =
        retryFailedIdempotent && def?.idempotency === 'idempotent';
      if (!safeToRetry) {
        throw new IncompleteMigrationError(
          `Detected failed migration "${failed._id}" (${failed.error?.message ?? 'unknown error'}). Automatic execution blocked.`,
        );
      }
    }

    const skippedAlreadyApplied: string[] = [];
    const eligible: MigrationDefinition[] = [];

    for (const migration of registered) {
      const rec = historyMap.get(migration.id);
      if (rec?.status === 'applied') {
        skippedAlreadyApplied.push(migration.id);
      } else if (
        !rec ||
        rec.status === 'rolled_back' ||
        (rec.status === 'failed' &&
          retryFailedIdempotent &&
          migration.idempotency === 'idempotent')
      ) {
        eligible.push(migration);
      }

      if (targetId && migration.id === targetId) {
        break;
      }
    }

    this.logger.info('pending_migrations_identified', {
      scope,
      details: {
        pendingCount: eligible.length,
        pendingIds: eligible.map((m) => m.id),
      },
    });

    if (dryRun || eligible.length === 0) {
      return {
        scope,
        dryRun,
        executed: [],
        skippedAlreadyApplied,
        plannedForDryRun: dryRun ? eligible.map((m) => m.id) : [],
      };
    }

    await this.lockManager.acquire(scope, this.runnerId, lockTtlMs);
    const executed: Array<{ id: string; version: string; durationMs: number }> =
      [];

    try {
      for (const migration of eligible) {
        const checksum = computeMigrationChecksum(migration);
        const { alreadyApplied, startedAt } =
          await this.historyStore.beginExecution(
            migration,
            checksum,
            this.runnerId,
            { retryFailedIdempotent },
          );

        if (alreadyApplied) {
          skippedAlreadyApplied.push(migration.id);
          continue;
        }

        this.logger.info('migration_execution_started', {
          scope,
          migrationId: migration.id,
          version: migration.version,
          details: { idempotency: migration.idempotency },
        });

        const ctx: MigrationContext = {
          db: this.db,
          scope,
          dryRun: false,
          runnerId: this.runnerId,
          logger: this.logger,
        };

        try {
          await migration.up(ctx);
          const durationMs = await this.historyStore.markApplied(
            migration.id,
            startedAt,
          );
          this.logger.info('migration_execution_completed', {
            scope,
            migrationId: migration.id,
            version: migration.version,
            durationMs,
          });
          executed.push({
            id: migration.id,
            version: migration.version,
            durationMs,
          });
        } catch (err) {
          const durationMs = await this.historyStore.markFailed(
            migration.id,
            startedAt,
            err,
          );
          this.logger.error('migration_execution_failed', {
            scope,
            migrationId: migration.id,
            version: migration.version,
            durationMs,
            details: {
              error: err instanceof Error ? err.message : String(err),
            },
          });
          throw err;
        }
      }
    } finally {
      await this.lockManager.release(scope, this.runnerId);
    }

    return {
      scope,
      dryRun: false,
      executed,
      skippedAlreadyApplied,
      plannedForDryRun: [],
    };
  }

  async down(
    options: RollbackMigrationsOptions,
  ): Promise<RollbackMigrationsResult> {
    const {
      scope,
      steps = 1,
      migrationId,
      dryRun = false,
      lockTtlMs = DEFAULT_LOCK_TTL_MS,
    } = options;

    if (steps < 1 && !migrationId) {
      throw new MigrationValidationError('Rollback steps must be >= 1.');
    }

    if (!dryRun) {
      await this.initialize();
    }

    const registeredAsc = this.registry.getAll(scope);
    const history = await this.historyStore.getByScope(scope);
    const appliedSet = new Set(
      history.filter((h) => h.status === 'applied').map((h) => h._id),
    );

    const appliedDesc = [...registeredAsc]
      .reverse()
      .filter((m) => appliedSet.has(m.id));

    let targets: MigrationDefinition[];
    if (migrationId) {
      const targetIndex = appliedDesc.findIndex((m) => m.id === migrationId);
      if (targetIndex === -1) {
        throw new MigrationValidationError(
          `Applied migration "${migrationId}" was not found in scope "${scope}".`,
        );
      }
      // Enforce reverse-order LIFO rollback safety: cannot roll back an older migration without rolling back newer applied ones first
      if (targetIndex !== 0) {
        const newerApplied = appliedDesc
          .slice(0, targetIndex)
          .map((m) => m.id)
          .join(', ');
        throw new IrreversibleMigrationError(
          `Cannot roll back "${migrationId}" directly because newer migrations remain applied: ${newerApplied}. Roll back in reverse version order.`,
        );
      }
      targets = [appliedDesc[0]];
    } else {
      targets = appliedDesc.slice(0, steps);
    }

    // Validate reversibility before taking lock or executing any down()
    for (const target of targets) {
      if (!target.reversible || typeof target.down !== 'function') {
        throw new IrreversibleMigrationError(
          `Migration "${target.id}" (version ${target.version}) is marked irreversible and does not support rollback.`,
        );
      }
    }

    if (dryRun || targets.length === 0) {
      return {
        scope,
        dryRun,
        rolledBack: [],
        plannedForDryRun: dryRun ? targets.map((m) => m.id) : [],
      };
    }

    await this.lockManager.acquire(scope, this.runnerId, lockTtlMs);
    const rolledBack: Array<{
      id: string;
      version: string;
      durationMs: number;
    }> = [];

    try {
      for (const target of targets) {
        const startedAt = new Date();
        this.logger.info('migration_rollback_started', {
          scope,
          migrationId: target.id,
          version: target.version,
        });

        const ctx: MigrationContext = {
          db: this.db,
          scope,
          dryRun: false,
          runnerId: this.runnerId,
          logger: this.logger,
        };

        try {
          await target.down!(ctx);
          const durationMs = await this.historyStore.markRolledBack(
            target.id,
            startedAt,
          );
          this.logger.info('migration_rollback_completed', {
            scope,
            migrationId: target.id,
            version: target.version,
            durationMs,
          });
          rolledBack.push({
            id: target.id,
            version: target.version,
            durationMs,
          });
        } catch (err) {
          const durationMs = await this.historyStore.markFailed(
            target.id,
            startedAt,
            err,
          );
          this.logger.error('migration_rollback_failed', {
            scope,
            migrationId: target.id,
            version: target.version,
            durationMs,
            details: {
              error: err instanceof Error ? err.message : String(err),
            },
          });
          throw err;
        }
      }
    } finally {
      await this.lockManager.release(scope, this.runnerId);
    }

    return {
      scope,
      dryRun: false,
      rolledBack,
      plannedForDryRun: [],
    };
  }
}
