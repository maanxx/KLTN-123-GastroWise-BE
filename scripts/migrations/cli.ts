import * as dotenv from 'dotenv';
import * as path from 'path';
import {
  JsonMigrationLogger,
  MigrationEngine,
  parseMigrationCliArgs,
  withMigrationDatabase,
} from '@shared/migrations';
import { createDefaultMigrationRegistry } from './migrations.registry';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export async function runMigrationCli(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const logger = new JsonMigrationLogger();
  const parsed = parseMigrationCliArgs(argv);
  const registry = createDefaultMigrationRegistry();

  await withMigrationDatabase(parsed.scope, async (db, config) => {
    logger.info('migration_cli_connected', {
      scope: parsed.scope,
      details: {
        command: parsed.command,
        dbName: config.dbName,
        target: config.redactedUri,
        dryRun: parsed.dryRun,
      },
    });

    const engine = new MigrationEngine(db, registry, { logger });

    if (parsed.command === 'status') {
      const report = await engine.status(parsed.scope);
      console.log(
        JSON.stringify(
          {
            scope: report.scope,
            totalRegistered: report.totalRegistered,
            appliedCount: report.applied.length,
            pendingCount: report.pending.length,
            incompleteOrFailedCount: report.incompleteOrFailed.length,
            activeLock: report.activeLock
              ? {
                  ownerId: report.activeLock.ownerId,
                  expiresAt: report.activeLock.expiresAt,
                }
              : null,
            appliedIds: report.applied.map((a) => a._id),
            pendingIds: report.pending.map((p) => p.id),
            incompleteOrFailedIds: report.incompleteOrFailed.map((f) => ({
              id: f._id,
              status: f.status,
            })),
          },
          null,
          2,
        ),
      );
      return;
    }

    if (parsed.command === 'up') {
      const res = await engine.up({
        scope: parsed.scope,
        targetId: parsed.targetId,
        dryRun: parsed.dryRun,
        retryFailedIdempotent: parsed.retryFailedIdempotent,
      });
      console.log(JSON.stringify(res, null, 2));
      return;
    }

    const res = await engine.down({
      scope: parsed.scope,
      steps: parsed.steps ?? 1,
      migrationId: parsed.targetId,
      dryRun: parsed.dryRun,
    });
    console.log(JSON.stringify(res, null, 2));
  });
}

if (require.main === module) {
  runMigrationCli().catch((err) => {
    const logger = new JsonMigrationLogger();
    logger.error('migration_cli_error', {
      details: {
        name: err instanceof Error ? err.name : 'Error',
        message: err instanceof Error ? err.message : String(err),
      },
    });
    process.exit(1);
  });
}
