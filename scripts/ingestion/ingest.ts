import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import {
  parseIngestionCliArgs,
  rollbackIngestionBatch,
  runRestaurantIngestionPipeline,
  withIngestionDatabase,
} from '@shared/ingestion';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export async function runIngestionCli(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const parsed = parseIngestionCliArgs(argv);

  const output = await withIngestionDatabase(async (db, config) => {
    if (parsed.mode === 'rollback') {
      return {
        targetDb: config.dbName,
        targetUriRedacted: config.redactedUri,
        rollback: await rollbackIngestionBatch(
          db,
          parsed.rollbackBatchId || '',
          {
            dryRun: parsed.dryRun,
          },
        ),
      };
    }

    const absFilePath = path.resolve(process.cwd(), parsed.filePath || '');
    const rawContent = fs.readFileSync(absFilePath, 'utf8');

    return runRestaurantIngestionPipeline(db, {
      rawContent,
      format: parsed.format,
      batchId: parsed.batchId,
      mode: parsed.mode,
      targetDb: config.dbName,
      targetUriRedacted: config.redactedUri,
    });
  });

  const serialized = JSON.stringify(output, null, 2);
  if (parsed.reportOutPath) {
    const outPath = path.resolve(process.cwd(), parsed.reportOutPath);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${serialized}\n`, 'utf8');
  }

  console.log(serialized);
}

if (require.main === module) {
  runIngestionCli().catch((err) => {
    console.error(
      JSON.stringify({
        level: 'ERROR',
        component: 'RestaurantIngestionCli',
        error: err instanceof Error ? err.name : 'Error',
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    process.exit(1);
  });
}
