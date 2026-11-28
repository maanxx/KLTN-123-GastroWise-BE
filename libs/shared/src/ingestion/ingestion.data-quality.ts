import {
  DataQualityReport,
  DataQualityStatus,
  DuplicateCandidateEntry,
  ErrorCodeGroupSummary,
  EXTERNAL_SOURCE_FOODY,
  IngestionValidationError,
  IngestionValidationIssue,
  NormalizedRestaurantCandidate,
  ParsedRawRecord,
  RejectedRecordSample,
  SUPPORTED_INGESTION_SOURCES,
} from './ingestion.types';
import {
  computeBatchChecksumSha256,
  createIngestionBatchId,
  parseRawIngestionInput,
  RawInputFormat,
} from './ingestion.staging';
import {
  isSupportedIngestionSource,
  validateAndNormalizeRestaurantRecord,
} from './ingestion.normalizer';

export const MAX_REJECTED_SAMPLE_RECORDS = 50 as const;
export const MAX_DUPLICATE_CANDIDATE_SAMPLES = 50 as const;

export interface EvaluateDataQualityOptions {
  rawContent?: string;
  records?: Array<Record<string, unknown>>;
  format?: RawInputFormat;
  source?: string;
  batchId?: string;
  maxRejectedSample?: number;
}

export interface DataQualityEvaluationResult {
  batchId: string;
  source: string;
  validatedCandidates: NormalizedRestaurantCandidate[];
  rejectedRecords: RejectedRecordSample[];
  errors: IngestionValidationIssue[];
  warnings: IngestionValidationIssue[];
  infos: IngestionValidationIssue[];
  report: DataQualityReport;
}

const MISSING_ERROR_CODES = new Set([
  'MISSING_EXTERNAL_ID',
  'MISSING_NAME',
  'MISSING_ADDRESS',
  'MISSING_RATING',
  'MISSING_OR_ZERO_PRICE',
  'MISSING_TAGS',
]);

const INVALID_ERROR_CODES = new Set([
  'MALFORMED_RECORD',
  'UNSUPPORTED_SOURCE_FORMAT',
  'DELETED_UPSTREAM_RECORD',
  'INVALID_RATING',
  'INVALID_REVIEW_COUNT',
  'MALFORMED_URL',
  'MALFORMED_IMAGE_URL',
  'INVALID_OR_MISSING_COORDINATES',
  'INVALID_PHONE_NUMBER',
  'INCOMPLETE_ADDRESS',
  'AMBIGUOUS_RATING_SCALE',
]);

function normalizeMatchToken(value: unknown): string {
  return typeof value === 'string'
    ? value.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
    : '';
}

function normalizeUrlToken(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().replace(/\/+$/, '').toLowerCase();
}

function sanitizeRawPreview(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  const blockedKeyPattern = /password|secret|token|api[_-]?key|auth/i;
  let count = 0;
  for (const [k, v] of Object.entries(payload)) {
    if (blockedKeyPattern.test(k)) {
      continue;
    }
    if (count >= 12) {
      break;
    }
    safe[k] = v;
    count += 1;
  }
  return safe;
}

export function buildDataQualityReport(params: {
  totalInputRecords: number;
  validRecords: number;
  rejectedRecords: number;
  errors: readonly IngestionValidationIssue[];
  warnings: readonly IngestionValidationIssue[];
  infos: readonly IngestionValidationIssue[];
  duplicateCandidates: readonly DuplicateCandidateEntry[];
  rejectedSample: readonly RejectedRecordSample[];
}): DataQualityReport {
  const warningRecordIndices = new Set<number>();
  const infoRecordIndices = new Set<number>();
  const missingFieldCounts: Record<string, number> = {};
  const invalidFieldCounts: Record<string, number> = {};
  const grouped = new Map<string, ErrorCodeGroupSummary>();

  const recordIssue = (issue: IngestionValidationIssue): void => {
    if (issue.severity === 'warning') {
      warningRecordIndices.add(issue.recordIndex);
    } else if (issue.severity === 'info') {
      infoRecordIndices.add(issue.recordIndex);
    }

    if (MISSING_ERROR_CODES.has(issue.errorCode)) {
      missingFieldCounts[issue.field] =
        (missingFieldCounts[issue.field] ?? 0) + 1;
    }
    if (INVALID_ERROR_CODES.has(issue.errorCode)) {
      invalidFieldCounts[issue.field] =
        (invalidFieldCounts[issue.field] ?? 0) + 1;
    }

    const groupKey = `${issue.severity}::${issue.errorCode}`;
    const existing = grouped.get(groupKey);
    if (existing) {
      existing.count += 1;
    } else {
      grouped.set(groupKey, {
        errorCode: issue.errorCode,
        severity: issue.severity,
        count: 1,
      });
    }
  };

  for (const issue of params.errors) recordIssue(issue);
  for (const issue of params.warnings) recordIssue(issue);
  for (const issue of params.infos) recordIssue(issue);

  const intraBatchCount = params.duplicateCandidates.filter(
    (d) => d.matchType === 'intra_batch',
  ).length;
  const existingDbCandidateCount = params.duplicateCandidates.filter(
    (d) => d.matchType === 'existing_db_candidate',
  ).length;
  const totalCandidateCount = intraBatchCount + existingDbCandidateCount;

  const overallQualityStatus: DataQualityStatus =
    params.rejectedRecords > 0 || params.errors.length > 0
      ? 'FAILED'
      : warningRecordIndices.size > 0 || totalCandidateCount > 0
        ? 'PASSED_WITH_WARNINGS'
        : 'PASSED';

  const issuesByErrorCode = Array.from(grouped.values()).sort((a, b) =>
    b.count !== a.count
      ? b.count - a.count
      : a.errorCode.localeCompare(b.errorCode),
  );

  return {
    totalInputRecords: params.totalInputRecords,
    validRecords: params.validRecords,
    rejectedRecords: params.rejectedRecords,
    warningRecords: warningRecordIndices.size,
    infoRecords: infoRecordIndices.size,
    duplicateCandidates: {
      intraBatchCount,
      existingDbCandidateCount,
      confirmedDuplicatesCount: 0,
      totalCandidateCount,
      note: 'Duplicate candidates are flagged for review or upsert matching only; confirmed duplicates require human review and existing records are never auto-deleted or merged.',
      samples: params.duplicateCandidates.slice(
        0,
        MAX_DUPLICATE_CANDIDATE_SAMPLES,
      ),
    },
    missingFieldCounts,
    invalidFieldCounts,
    issuesByErrorCode,
    rejectedSample: params.rejectedSample.slice(0, MAX_REJECTED_SAMPLE_RECORDS),
    overallQualityStatus,
  };
}

/**
 * Evaluates raw restaurant records into canonical candidates + a structured DataQualityReport
 * purely in memory without performing any database writes.
 */
export function evaluateRestaurantDataQuality(
  options: EvaluateDataQualityOptions,
): DataQualityEvaluationResult {
  const rawSource = options.source?.trim() || EXTERNAL_SOURCE_FOODY;
  const source = rawSource.toLowerCase();
  if (!isSupportedIngestionSource(source)) {
    throw new IngestionValidationError(
      `Unsupported batch source "${rawSource}". Supported sources: ${SUPPORTED_INGESTION_SOURCES.join(', ')}.`,
    );
  }
  const maxRejectedSample =
    options.maxRejectedSample ?? MAX_REJECTED_SAMPLE_RECORDS;

  let parsedRecords: ParsedRawRecord[];
  if (Array.isArray(options.records)) {
    parsedRecords = options.records.map((payload, idx) => ({
      recordIndex: idx,
      payload:
        typeof payload === 'object' &&
        payload !== null &&
        !Array.isArray(payload)
          ? payload
          : { _invalidPayload: payload },
    }));
  } else if (typeof options.rawContent === 'string') {
    parsedRecords = parseRawIngestionInput(
      options.rawContent,
      options.format || 'auto',
    );
  } else {
    throw new IngestionValidationError(
      'Either rawContent or records array must be provided for data quality evaluation.',
    );
  }

  const checksumSeed =
    typeof options.rawContent === 'string'
      ? options.rawContent
      : JSON.stringify(parsedRecords.map((r) => r.payload));
  const batchId =
    options.batchId?.trim() ||
    createIngestionBatchId(computeBatchChecksumSha256(checksumSeed));

  const errors: IngestionValidationIssue[] = [];
  const warnings: IngestionValidationIssue[] = [];
  const infos: IngestionValidationIssue[] = [];
  const rejectedRecords: RejectedRecordSample[] = [];
  const validatedCandidates: NormalizedRestaurantCandidate[] = [];
  const duplicateCandidates: DuplicateCandidateEntry[] = [];

  const seenTier1 = new Set<string>();
  const seenSlugs = new Set<string>();
  const seenUrls = new Set<string>();
  const seenNameAddr = new Set<string>();

  for (const parsed of parsedRecords) {
    const outcome = validateAndNormalizeRestaurantRecord(
      parsed,
      batchId,
      source,
    );

    if (!outcome.candidate) {
      errors.push(...outcome.errors);
      warnings.push(...outcome.warnings);
      infos.push(...outcome.infos);
      if (rejectedRecords.length < maxRejectedSample) {
        rejectedRecords.push({
          recordIndex: parsed.recordIndex,
          sourceId: outcome.errors[0]?.sourceId,
          errors: outcome.errors,
          rawPreview: sanitizeRawPreview(parsed.payload),
        });
      }
      continue;
    }

    const cand = outcome.candidate;
    const tier1Key = `${cand.externalSource}::${cand.externalSourceId}`;
    const slugKey = normalizeMatchToken(cand.slug);
    const urlKey = normalizeUrlToken(cand.urlGoc);
    const nameAddrKey =
      cand.tenQuan && cand.diaChi
        ? `${normalizeMatchToken(cand.tenQuan)}::${normalizeMatchToken(cand.diaChi)}`
        : '';

    const isDup =
      seenTier1.has(tier1Key) ||
      (slugKey.length > 0 && seenSlugs.has(slugKey)) ||
      (urlKey.length > 0 && seenUrls.has(urlKey)) ||
      (nameAddrKey.length > 0 && seenNameAddr.has(nameAddrKey));

    if (isDup) {
      duplicateCandidates.push({
        recordIndex: cand.recordIndex,
        externalSource: cand.externalSource,
        externalSourceId: cand.externalSourceId,
        tenQuan: cand.tenQuan,
        matchType: 'intra_batch',
      });
      warnings.push({
        recordIndex: cand.recordIndex,
        field: 'RestaurantID/slug/name+address',
        errorCode: 'DUPLICATE_CANDIDATE_IN_BATCH',
        reason: `Candidate matches an earlier record in the same batch (${tier1Key}).`,
        severity: 'warning',
        sourceId: cand.externalSourceId,
      });
      continue;
    }

    seenTier1.add(tier1Key);
    if (slugKey) seenSlugs.add(slugKey);
    if (urlKey) seenUrls.add(urlKey);
    if (nameAddrKey) seenNameAddr.add(nameAddrKey);

    warnings.push(...outcome.warnings);
    infos.push(...outcome.infos);
    validatedCandidates.push(cand);
  }

  const report = buildDataQualityReport({
    totalInputRecords: parsedRecords.length,
    validRecords: validatedCandidates.length,
    rejectedRecords:
      parsedRecords.length -
      validatedCandidates.length -
      duplicateCandidates.length,
    errors,
    warnings,
    infos,
    duplicateCandidates,
    rejectedSample: rejectedRecords,
  });

  return {
    batchId,
    source,
    validatedCandidates,
    rejectedRecords,
    errors,
    warnings,
    infos,
    report,
  };
}
