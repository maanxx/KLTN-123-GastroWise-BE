import { IngestionMode, IngestionValidationError } from './ingestion.types';
import { assertLocalIngestionApplyAllowed } from './ingestion.connection';
import type { RawInputFormat } from './ingestion.staging';
import type { RecoveryAction } from './ingestion.pipeline';

export interface ParsedIngestionCliArgs {
  mode: IngestionMode;
  dryRun: boolean;
  filePath?: string;
  format: RawInputFormat;
  source?: string;
  batchId?: string;
  rollbackBatchId?: string;
  recoverBatchId?: string;
  recoverAction?: RecoveryAction;
  reportOutPath?: string;
}

/**
 * Parses M10.2.1 ingestion CLI arguments with dry-run enabled by default
 * and blocks inline URI/credential flags as well as Atlas override flags.
 */
export function parseIngestionCliArgs(
  argv: readonly string[],
): ParsedIngestionCliArgs {
  let mode: IngestionMode = 'dry-run';
  let filePath: string | undefined;
  let format: RawInputFormat = 'auto';
  let source: string | undefined;
  let batchId: string | undefined;
  let rollbackBatchId: string | undefined;
  let recoverBatchId: string | undefined;
  let recoverAction: RecoveryAction = 'auto';
  let reportOutPath: string | undefined;
  let sawApplyFlag = false;
  let sawDryRunFlag = false;
  let sawPreflightIndexes = false;
  let sawEnsureIndexes = false;

  for (const arg of argv) {
    if (
      arg.startsWith('--uri') ||
      arg.startsWith('--connection') ||
      arg.startsWith('--password') ||
      arg === '--allow-atlas'
    ) {
      throw new IngestionValidationError(
        `Prohibited CLI flag "${arg}": M10.2 ingestion strictly uses local environment variables and never permits Atlas targets.`,
      );
    }

    if (arg === '--dry-run') {
      sawDryRunFlag = true;
      mode = 'dry-run';
    } else if (arg === '--apply') {
      sawApplyFlag = true;
      mode = 'apply';
    } else if (arg.startsWith('--file=')) {
      filePath = arg.slice('--file='.length).trim();
    } else if (arg.startsWith('--format=')) {
      const val = arg.slice('--format='.length).trim().toLowerCase();
      if (val !== 'json' && val !== 'jsonl' && val !== 'auto') {
        throw new IngestionValidationError(
          `Invalid --format="${val}". Expected json, jsonl, or auto.`,
        );
      }
      format = val;
    } else if (arg.startsWith('--source=')) {
      source = arg.slice('--source='.length).trim();
    } else if (arg.startsWith('--batch-id=')) {
      batchId = arg.slice('--batch-id='.length).trim();
    } else if (arg.startsWith('--rollback=')) {
      rollbackBatchId = arg.slice('--rollback='.length).trim();
    } else if (arg.startsWith('--recover=')) {
      recoverBatchId = arg.slice('--recover='.length).trim();
    } else if (arg.startsWith('--recover-action=')) {
      const val = arg.slice('--recover-action='.length).trim().toLowerCase();
      if (val !== 'auto' && val !== 'complete' && val !== 'compensate') {
        throw new IngestionValidationError(
          `Invalid --recover-action="${val}". Expected auto, complete, or compensate.`,
        );
      }
      recoverAction = val;
    } else if (arg === '--preflight-indexes') {
      sawPreflightIndexes = true;
    } else if (arg === '--ensure-indexes') {
      sawEnsureIndexes = true;
    } else if (arg.startsWith('--report-out=')) {
      reportOutPath = arg.slice('--report-out='.length).trim();
    } else {
      throw new IngestionValidationError(
        `Unknown ingestion CLI flag: "${arg}".`,
      );
    }
  }

  if (sawApplyFlag && sawDryRunFlag) {
    throw new IngestionValidationError(
      'Cannot specify both --dry-run and --apply in the same invocation.',
    );
  }

  const specialModeCount =
    Number(rollbackBatchId !== undefined) +
    Number(recoverBatchId !== undefined) +
    Number(sawPreflightIndexes) +
    Number(sawEnsureIndexes);
  if (specialModeCount > 1) {
    throw new IngestionValidationError(
      'Cannot combine --rollback, --recover, --preflight-indexes, or --ensure-indexes in the same invocation.',
    );
  }

  if (sawPreflightIndexes) {
    if (sawApplyFlag) {
      throw new IngestionValidationError(
        '--preflight-indexes is read-only and cannot be combined with --apply. Use --ensure-indexes --apply to create indexes after a clean preflight.',
      );
    }
    return {
      mode: 'preflight-indexes',
      dryRun: true,
      format,
      reportOutPath,
    };
  }

  if (sawEnsureIndexes) {
    return {
      mode: 'ensure-indexes',
      dryRun: !sawApplyFlag,
      format,
      reportOutPath,
    };
  }

  if (rollbackBatchId !== undefined) {
    if (!rollbackBatchId) {
      throw new IngestionValidationError(
        '--rollback=<batchId> cannot be empty.',
      );
    }
    return {
      mode: 'rollback',
      dryRun: !sawApplyFlag,
      format,
      rollbackBatchId,
      reportOutPath,
    };
  }

  if (recoverBatchId !== undefined) {
    if (!recoverBatchId) {
      throw new IngestionValidationError(
        '--recover=<batchId> cannot be empty.',
      );
    }
    return {
      mode: 'recover',
      dryRun: !sawApplyFlag,
      format,
      recoverBatchId,
      recoverAction,
      reportOutPath,
    };
  }

  if (!filePath) {
    throw new IngestionValidationError(
      'Missing required "--file=<path>" option (or use "--rollback=<batchId>" / "--recover=<batchId>").',
    );
  }

  return {
    mode,
    dryRun: mode !== 'apply',
    filePath,
    format,
    ...(source ? { source } : {}),
    batchId,
    reportOutPath,
  };
}

/**
 * Explicitly determines whether a parsed CLI invocation can mutate MongoDB.
 * Covers normal apply, rollback --apply, recover --apply, and ensure-indexes --apply.
 */
export function isMutatingIngestionCliArgs(
  parsed: ParsedIngestionCliArgs,
): boolean {
  if (parsed.mode === 'dry-run' || parsed.mode === 'preflight-indexes') {
    return false;
  }
  return !parsed.dryRun;
}

/**
 * Enforces GASTROWISE_ALLOW_LOCAL_INGESTION=true for every mutating CLI invocation,
 * while allowing read-only and dry-run modes without the opt-in flag.
 */
export function assertIngestionCliExecutionAllowed(
  parsed: ParsedIngestionCliArgs,
  env: Record<string, string | undefined> = process.env,
): void {
  if (isMutatingIngestionCliArgs(parsed)) {
    assertLocalIngestionApplyAllowed(env);
  }
}
