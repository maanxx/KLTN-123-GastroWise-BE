import { IngestionMode, IngestionValidationError } from './ingestion.types';
import type { RawInputFormat } from './ingestion.staging';

export interface ParsedIngestionCliArgs {
  mode: IngestionMode;
  dryRun: boolean;
  filePath?: string;
  format: RawInputFormat;
  batchId?: string;
  rollbackBatchId?: string;
  reportOutPath?: string;
}

/**
 * Parses M10.2 ingestion CLI arguments with dry-run enabled by default
 * and blocks inline URI/credential flags as well as Atlas override flags.
 */
export function parseIngestionCliArgs(
  argv: readonly string[],
): ParsedIngestionCliArgs {
  let mode: IngestionMode = 'dry-run';
  let filePath: string | undefined;
  let format: RawInputFormat = 'auto';
  let batchId: string | undefined;
  let rollbackBatchId: string | undefined;
  let reportOutPath: string | undefined;
  let sawApplyFlag = false;
  let sawDryRunFlag = false;

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
    } else if (arg.startsWith('--batch-id=')) {
      batchId = arg.slice('--batch-id='.length).trim();
    } else if (arg.startsWith('--rollback=')) {
      rollbackBatchId = arg.slice('--rollback='.length).trim();
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

  if (!filePath) {
    throw new IngestionValidationError(
      'Missing required "--file=<path>" option (or use "--rollback=<batchId>").',
    );
  }

  return {
    mode,
    dryRun: mode !== 'apply',
    filePath,
    format,
    batchId,
    reportOutPath,
  };
}
