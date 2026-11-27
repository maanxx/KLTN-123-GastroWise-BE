import {
  MigrationDatabaseScope,
  MigrationValidationError,
} from './migration.types';

export type CliCommand = 'status' | 'up' | 'down';

export interface ParsedCliArgs {
  command: CliCommand;
  scope: MigrationDatabaseScope;
  targetId?: string;
  steps?: number;
  dryRun: boolean;
  retryFailedIdempotent: boolean;
  allowAtlas: boolean;
}

export function parseMigrationCliArgs(argv: readonly string[]): ParsedCliArgs {
  const args = [...argv];
  const commandRaw = args.shift();
  if (commandRaw !== 'status' && commandRaw !== 'up' && commandRaw !== 'down') {
    throw new MigrationValidationError(
      'First argument must be a migration command: "status", "up", or "down".',
    );
  }

  let scope: MigrationDatabaseScope | undefined;
  let targetId: string | undefined;
  let steps: number | undefined;
  let dryRun = false;
  let retryFailedIdempotent = false;
  let allowAtlas = false;

  for (const arg of args) {
    if (
      arg.startsWith('--uri') ||
      arg.startsWith('--connection') ||
      arg.startsWith('--password')
    ) {
      throw new MigrationValidationError(
        'Passing database URIs or credentials via CLI arguments is prohibited. Use environment variables.',
      );
    }
    if (arg.startsWith('--scope=')) {
      const val = arg.slice('--scope='.length);
      if (val !== 'core' && val !== 'planning') {
        throw new MigrationValidationError(
          `Invalid --scope="${val}". Expected "core" or "planning".`,
        );
      }
      scope = val;
    } else if (arg.startsWith('--target=')) {
      targetId = arg.slice('--target='.length).trim();
    } else if (arg.startsWith('--id=')) {
      targetId = arg.slice('--id='.length).trim();
    } else if (arg.startsWith('--steps=')) {
      const parsed = Number.parseInt(arg.slice('--steps='.length), 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new MigrationValidationError(
          '--steps must be a positive integer.',
        );
      }
      steps = parsed;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--retry-failed-idempotent') {
      retryFailedIdempotent = true;
    } else if (arg === '--allow-atlas') {
      allowAtlas = true;
    } else {
      throw new MigrationValidationError(`Unknown CLI option: "${arg}".`);
    }
  }

  if (!scope) {
    throw new MigrationValidationError(
      'Missing required option "--scope=core" or "--scope=planning".',
    );
  }

  return {
    command: commandRaw,
    scope,
    targetId,
    steps,
    dryRun,
    retryFailedIdempotent,
    allowAtlas,
  };
}
