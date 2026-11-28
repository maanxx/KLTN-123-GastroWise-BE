import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import {
  EXTERNAL_SOURCE_FOODY,
  IngestionValidationError,
  preflightDishExternalSourceUniqueIndex,
  rolloutDishIngestionIndexes,
  runLocalFoodDatasetIngestionPipeline,
  withIngestionDatabase,
} from '@shared/ingestion';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface FoodDatasetCliArgs {
  filePath?: string;
  source: string;
  batchId?: string;
  mode: 'dry-run' | 'apply' | 'preflight-indexes' | 'ensure-indexes';
  dryRun: boolean;
  reportOutPath?: string;
}

export function parseFoodDatasetCliArgs(
  argv: readonly string[],
  env: Record<string, string | undefined> = process.env,
): FoodDatasetCliArgs {
  let filePath = '';
  let source: string = EXTERNAL_SOURCE_FOODY;
  let batchId: string | undefined;
  let mode: FoodDatasetCliArgs['mode'] = 'dry-run';
  let applyFlag = false;
  let reportOutPath: string | undefined;

  for (const arg of argv) {
    if (arg.startsWith('--file=')) {
      filePath = arg.slice('--file='.length).trim();
    } else if (arg.startsWith('--source=')) {
      source = arg.slice('--source='.length).trim();
    } else if (arg.startsWith('--batch-id=')) {
      batchId = arg.slice('--batch-id='.length).trim();
    } else if (arg.startsWith('--report-out=')) {
      reportOutPath = arg.slice('--report-out='.length).trim();
    } else if (arg === '--preflight-indexes') {
      mode = 'preflight-indexes';
    } else if (arg === '--ensure-indexes') {
      mode = 'ensure-indexes';
    } else if (arg === '--apply') {
      applyFlag = true;
      if (mode === 'dry-run') mode = 'apply';
    } else if (arg === '--dry-run') {
      applyFlag = false;
      if (mode === 'apply') mode = 'dry-run';
    }
  }

  const isMutating =
    mode === 'apply' || (mode === 'ensure-indexes' && applyFlag);
  if (isMutating && env.GASTROWISE_ALLOW_LOCAL_INGESTION !== 'true') {
    throw new IngestionValidationError(
      'Refusing mutating --apply operation without explicit GASTROWISE_ALLOW_LOCAL_INGESTION=true guard.',
    );
  }

  if ((mode === 'dry-run' || mode === 'apply') && !filePath) {
    throw new IngestionValidationError(
      'Missing required --file=<path> argument for local food dataset ingestion.',
    );
  }

  return {
    filePath: filePath || undefined,
    source,
    batchId,
    mode,
    dryRun: !applyFlag,
    reportOutPath,
  };
}

export async function runFoodDatasetCli(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const parsed = parseFoodDatasetCliArgs(argv);

  const report = await withIngestionDatabase(async (db, config) => {
    if (parsed.mode === 'preflight-indexes') {
      return {
        targetDb: config.dbName,
        targetUriRedacted: config.redactedUri,
        dishIndexPreflight: await preflightDishExternalSourceUniqueIndex(db),
      };
    }

    if (parsed.mode === 'ensure-indexes') {
      return {
        targetDb: config.dbName,
        targetUriRedacted: config.redactedUri,
        dishIndexRollout: await rolloutDishIngestionIndexes(db, {
          dryRun: parsed.dryRun,
        }),
      };
    }

    const absFilePath = path.resolve(process.cwd(), parsed.filePath || '');
    const rawContent = fs.readFileSync(absFilePath, 'utf8');

    return runLocalFoodDatasetIngestionPipeline(db, {
      rawContent,
      source: parsed.source,
      batchId: parsed.batchId,
      mode: parsed.mode,
      targetDb: config.dbName,
      targetUriRedacted: config.redactedUri,
    });
  });

  const serialized = JSON.stringify(report, null, 2);
  if (parsed.reportOutPath) {
    const outPath = path.resolve(process.cwd(), parsed.reportOutPath);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${serialized}\n`, 'utf8');
  }

  console.log(serialized);
}

if (require.main === module) {
  runFoodDatasetCli().catch((err) => {
    console.error(
      JSON.stringify({
        level: 'ERROR',
        component: 'LocalFoodDatasetIngestionCli',
        error: err instanceof Error ? err.name : 'Error',
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    process.exit(1);
  });
}
