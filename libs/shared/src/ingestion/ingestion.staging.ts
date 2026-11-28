import { createHash } from 'crypto';
import type { Db } from 'mongodb';
import {
  EXTERNAL_SOURCE_FOODY,
  IngestionValidationError,
  ParsedRawRecord,
  RAW_STAGING_COLLECTION,
  RawStagingDocument,
} from './ingestion.types';

export type RawInputFormat = 'json' | 'jsonl' | 'auto';

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptionalText(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

/**
 * Computes deterministic SHA-256 checksum over raw fixture/batch contents.
 */
export function computeBatchChecksumSha256(rawContent: string): string {
  return createHash('sha256').update(rawContent, 'utf8').digest('hex');
}

/**
 * Generates a unique, human-readable ingestion batch identifier.
 */
export function createIngestionBatchId(
  checksumSha256: string,
  now: Date = new Date(),
): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  return `ingest_${stamp}_${checksumSha256.slice(0, 8)}`;
}

/**
 * Parses JSON (array, `{ records: [...] }`, single object) or newline-delimited JSONL
 * into indexed raw records while rejecting completely malformed payloads.
 */
export function parseRawIngestionInput(
  rawContent: string,
  format: RawInputFormat = 'auto',
): ParsedRawRecord[] {
  const trimmed = rawContent.trim();
  if (trimmed.length === 0) {
    return [];
  }

  if (
    format === 'json' ||
    (format === 'auto' && (trimmed.startsWith('[') || trimmed.startsWith('{')))
  ) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((entry, idx) => ({
          recordIndex: idx,
          payload: isPlainRecord(entry) ? entry : { _invalidPayload: entry },
        }));
      }
      if (isPlainRecord(parsed)) {
        if (Array.isArray(parsed.records)) {
          return parsed.records.map((entry, idx) => ({
            recordIndex: idx,
            payload: isPlainRecord(entry) ? entry : { _invalidPayload: entry },
          }));
        }
        return [{ recordIndex: 0, payload: parsed }];
      }
      throw new IngestionValidationError(
        'JSON input must be a restaurant object, an array of objects, or { records: [...] }.',
      );
    } catch (err) {
      if (format === 'json') {
        throw new IngestionValidationError(
          `Failed to parse JSON ingestion input: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      // In 'auto' mode, fall through to JSONL parsing if single JSON parse failed.
    }
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines.map((line, idx) => {
    try {
      const parsed: unknown = JSON.parse(line);
      return {
        recordIndex: idx,
        payload: isPlainRecord(parsed) ? parsed : { _invalidPayload: parsed },
      };
    } catch (err) {
      return {
        recordIndex: idx,
        payload: {
          _malformedJsonLine: line,
          _parseError: err instanceof Error ? err.message : String(err),
        },
      };
    }
  });
}

/**
 * Converts parsed raw records into staging documents preserving the full original payload.
 */
export function buildRawStagingDocuments(
  parsedRecords: readonly ParsedRawRecord[],
  options: {
    batchId: string;
    checksumSha256: string;
    source?: string;
    scrapedAt?: Date;
  },
): RawStagingDocument[] {
  const source = options.source || EXTERNAL_SOURCE_FOODY;
  const scrapedAt = options.scrapedAt || new Date();

  return parsedRecords.map(({ recordIndex, payload }) => ({
    batchId: options.batchId,
    recordIndex,
    source,
    sourceId: readOptionalText(payload, [
      'RestaurantID',
      'restaurantId',
      'externalSourceId',
    ]),
    sourceUrl: readOptionalText(payload, [
      'MicrositeUrl',
      'urlGoc',
      'RestaurantUrl',
    ]),
    scrapedAt,
    batchChecksumSha256: options.checksumSha256,
    payload,
  }));
}

/**
 * Persists raw staging records into `restaurants_raw_staging` idempotently.
 * In dry-run mode, writes zero documents to MongoDB.
 */
export async function stageRawIngestionRecords(
  db: Db,
  stagingDocs: readonly RawStagingDocument[],
  options: { dryRun: boolean },
): Promise<number> {
  if (options.dryRun || stagingDocs.length === 0) {
    return 0;
  }

  const collection = db.collection<RawStagingDocument>(RAW_STAGING_COLLECTION);
  const operations = stagingDocs.map((doc) => ({
    updateOne: {
      filter: { batchId: doc.batchId, recordIndex: doc.recordIndex },
      update: { $setOnInsert: doc },
      upsert: true,
    },
  }));

  const result = await collection.bulkWrite(operations, { ordered: false });
  return result.upsertedCount;
}
