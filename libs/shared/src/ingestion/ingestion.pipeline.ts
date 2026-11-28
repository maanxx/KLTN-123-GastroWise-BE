import { createHash } from 'crypto';
import { ObjectId } from 'mongodb';
import type { AnyBulkWriteOperation, Collection, Db } from 'mongodb';
import {
  DuplicateCandidateEntry,
  INGESTION_BATCHES_COLLECTION,
  IngestionBatchLedgerDocument,
  IngestionBatchSummary,
  IngestionInsertedRecordBackup,
  IngestionMode,
  IngestionQualityMetrics,
  IngestionRecoveryResult,
  IngestionRollbackConflict,
  IngestionRollbackResult,
  IngestionUpdatedBackup,
  IngestionValidationError,
  IngestionValidationIssue,
  LegacyNormalizedKeyBackfillResult,
  NormalizedRestaurantCandidate,
  RejectedRecordSample,
  RESTAURANTS_COLLECTION,
} from './ingestion.types';
import {
  buildDataQualityReport,
  MAX_REJECTED_SAMPLE_RECORDS,
} from './ingestion.data-quality';
import {
  assertLocalIngestionApplyAllowed,
  resolveIngestionDatabaseConfig,
  withIngestionDatabase,
} from './ingestion.connection';
import {
  redactSensitiveDiagnosticString,
  sanitizeRawPreview,
} from './ingestion.sanitizer';
import {
  buildRawStagingDocuments,
  computeBatchChecksumSha256,
  createIngestionBatchId,
  parseRawIngestionInput,
  RawInputFormat,
  stageRawIngestionRecords,
} from './ingestion.staging';
import {
  isSupportedIngestionSource,
  RecordNormalizationOutcome,
  validateAndNormalizeRestaurantRecord,
} from './ingestion.normalizer';

export interface RunIngestionOptions {
  rawContent: string;
  format?: RawInputFormat;
  source?: string;
  batchId?: string;
  mode?: IngestionMode;
  targetDb?: string;
  targetUriRedacted?: string;
  now?: Date;
  maxDedupResultsPerChunkFactor?: number;
}

export type RecoveryAction = 'auto' | 'complete' | 'compensate';

export const STANDALONE_MONGODB_LIMITATION_NOTE =
  'Standalone MongoDB does not support multi-document ACID transactions. Atomicity is enforced via write-ahead pending ledger persistence, pre-generated deterministic ObjectIds, compare-and-set rollback filters, and deterministic crash recovery.';

interface RestaurantDocRecord extends Record<string, unknown> {
  _id: ObjectId;
}

export function normalizeMatchKey(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeUrlKey(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().replace(/\/+$/, '').toLowerCase();
}

const BACKUP_TRACKED_KEYS = [
  'externalSource',
  'externalSourceId',
  'tenQuan',
  'diaChi',
  'cityId',
  'lat',
  'lon',
  'location',
  'diemTrungBinh',
  'rawRating',
  'ratingScale',
  '_ratingNormalized',
  'diemKhongGian',
  'diemViTri',
  'diemChatLuong',
  'diemPhucVu',
  'diemGiaCa',
  'foodyReviewsCount',
  'giaCa',
  'gioMoCua',
  'tags',
  'avatarUrl',
  'urlGoc',
  'slug',
  'contactPhone',
  'status',
  'normalizedNameAddressKey',
  'updatedAt',
] as const;

const DIGEST_STATE_KEYS = [
  ...BACKUP_TRACKED_KEYS,
  'ingestionBatchId',
  'ownerId',
  'reviewsCount',
  'isVerified',
  'isFeatured',
  'createdAt',
] as const;

function readFiniteRevision(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

export function computeNameAddressKey(
  tenQuan: unknown,
  diaChi: unknown,
): string {
  const nKey = normalizeMatchKey(tenQuan);
  const aKey = normalizeMatchKey(diaChi);
  return nKey && aKey ? `${nKey}::${aKey}` : '';
}

function canonicalizeValue(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof ObjectId) {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item));
  }
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    const normalized = canonicalizeValue(record[key]);
    if (normalized !== undefined) {
      sorted[key] = normalized;
    }
  }
  return sorted;
}

/**
 * Computes a deterministic SHA-256 digest over tracked catalog, batch, and protected user fields.
 */
export function computeTrackedDocumentDigest(
  doc: Record<string, unknown>,
): string {
  const snapshot: Record<string, unknown> = {};
  for (const key of DIGEST_STATE_KEYS) {
    if (key in doc && doc[key] !== undefined) {
      const val = canonicalizeValue(doc[key]);
      if (val !== undefined) {
        snapshot[key] = val;
      }
    }
  }
  const serialized = JSON.stringify(canonicalizeValue(snapshot));
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
}

function serializeIdentifier(value: unknown): string {
  if (value instanceof ObjectId) {
    return value.toString();
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function sameOptionalObjectId(a: unknown, b: unknown): boolean {
  if (a === undefined || a === null) {
    return b === undefined || b === null;
  }
  if (b === undefined || b === null) {
    return false;
  }
  return serializeIdentifier(a) === serializeIdentifier(b);
}

function extractBackupFields(
  existingDoc: RestaurantDocRecord,
  postUpdateSet: Record<string, unknown>,
  now: Date,
  nextRevision: number,
  postDigest: string,
): IngestionUpdatedBackup {
  const previousFields: Record<string, unknown> = {};
  for (const key of BACKUP_TRACKED_KEYS) {
    if (key in existingDoc && existingDoc[key] !== undefined) {
      previousFields[key] = existingDoc[key];
    }
  }
  const hadBatchIdBefore =
    'ingestionBatchId' in existingDoc &&
    existingDoc.ingestionBatchId !== undefined;
  if (hadBatchIdBefore) {
    previousFields.ingestionBatchId = existingDoc.ingestionBatchId;
  }

  const hadRevisionBefore =
    'ingestionRevision' in existingDoc &&
    existingDoc.ingestionRevision !== undefined;
  if (hadRevisionBefore) {
    previousFields.ingestionRevision = existingDoc.ingestionRevision;
  }

  const hadPostDigestBefore =
    'ingestionPostDigest' in existingDoc &&
    existingDoc.ingestionPostDigest !== undefined;
  if (hadPostDigestBefore) {
    previousFields.ingestionPostDigest = existingDoc.ingestionPostDigest;
  }

  const expectedOwnerId =
    existingDoc.ownerId instanceof ObjectId ||
    typeof existingDoc.ownerId === 'string'
      ? existingDoc.ownerId
      : null;

  return {
    docId: existingDoc._id,
    hadBatchIdBefore,
    hadRevisionBefore,
    hadPostDigestBefore,
    previousFields,
    postIngestionDigest: postDigest,
    expectedPostUpdatedAt: now,
    expectedPostRevision: nextRevision,
    expectedOwnerId,
    expectedReviewsCount:
      typeof existingDoc.reviewsCount === 'number' &&
      Number.isFinite(existingDoc.reviewsCount)
        ? existingDoc.reviewsCount
        : 0,
    expectedIsVerified: Boolean(existingDoc.isVerified),
    expectedIsFeatured: Boolean(existingDoc.isFeatured),
  };
}

function buildInsertRestaurantDoc(
  candidate: NormalizedRestaurantCandidate,
  now: Date,
): RestaurantDocRecord {
  const doc: RestaurantDocRecord = {
    _id: new ObjectId(),
    externalSource: candidate.externalSource,
    externalSourceId: candidate.externalSourceId,
    tenQuan: candidate.tenQuan,
    diaChi: candidate.diaChi,
    location: candidate.location,
    ratingScale: candidate.ratingScale,
    _ratingNormalized: candidate._ratingNormalized,
    giaCa: candidate.giaCa,
    gioMoCua: candidate.gioMoCua,
    tags: candidate.tags,
    avatarUrl: candidate.avatarUrl,
    urlGoc: candidate.urlGoc,
    slug: candidate.slug,
    contactPhone: candidate.contactPhone,
    reviewsCount: 0,
    status: candidate.status,
    isVerified: false,
    isFeatured: false,
    ingestionBatchId: candidate.ingestionBatchId,
    ingestionRevision: 1,
    createdAt: now,
    updatedAt: now,
  };

  const nameAddrKey = computeNameAddressKey(
    candidate.tenQuan,
    candidate.diaChi,
  );
  if (nameAddrKey) {
    doc.normalizedNameAddressKey = nameAddrKey;
  }

  if (candidate.cityId !== undefined) doc.cityId = candidate.cityId;
  if (candidate.lat !== undefined) doc.lat = candidate.lat;
  if (candidate.lon !== undefined) doc.lon = candidate.lon;
  if (candidate.diemTrungBinh !== undefined) {
    doc.diemTrungBinh = candidate.diemTrungBinh;
  }
  if (candidate.rawRating !== undefined) doc.rawRating = candidate.rawRating;
  if (candidate.diemKhongGian !== undefined) {
    doc.diemKhongGian = candidate.diemKhongGian;
  }
  if (candidate.diemViTri !== undefined) doc.diemViTri = candidate.diemViTri;
  if (candidate.diemChatLuong !== undefined) {
    doc.diemChatLuong = candidate.diemChatLuong;
  }
  if (candidate.diemPhucVu !== undefined) doc.diemPhucVu = candidate.diemPhucVu;
  if (candidate.diemGiaCa !== undefined) doc.diemGiaCa = candidate.diemGiaCa;
  if (candidate.foodyReviewsCount !== undefined) {
    doc.foodyReviewsCount = candidate.foodyReviewsCount;
  }

  doc.ingestionPostDigest = computeTrackedDocumentDigest(doc);
  return doc;
}

function buildSafeUpdateSetPayload(
  candidate: NormalizedRestaurantCandidate,
  existingDoc: RestaurantDocRecord,
  now: Date,
): {
  updateSet: Record<string, unknown>;
  nextRevision: number;
  postDigest: string;
} {
  const nativeReviewsCount =
    typeof existingDoc.reviewsCount === 'number' &&
    Number.isFinite(existingDoc.reviewsCount)
      ? existingDoc.reviewsCount
      : 0;
  const preserveUserRating = nativeReviewsCount > 0;
  const nextRevision = readFiniteRevision(existingDoc.ingestionRevision) + 1;

  const updateSet: Record<string, unknown> = {
    externalSource: candidate.externalSource,
    externalSourceId: candidate.externalSourceId,
    tenQuan: candidate.tenQuan,
    ingestionBatchId: candidate.ingestionBatchId,
    ingestionRevision: nextRevision,
    updatedAt: now,
  };

  if (candidate.diaChi) {
    updateSet.diaChi = candidate.diaChi;
  }
  const mergedAddress = candidate.diaChi || existingDoc.diaChi;
  const nameAddrKey = computeNameAddressKey(candidate.tenQuan, mergedAddress);
  if (nameAddrKey) {
    updateSet.normalizedNameAddressKey = nameAddrKey;
  }
  if (candidate.cityId) {
    updateSet.cityId = candidate.cityId;
  }
  if (candidate.coordsValid && candidate.location) {
    updateSet.lat = candidate.lat;
    updateSet.lon = candidate.lon;
    updateSet.location = candidate.location;
  } else if (existingDoc.location === undefined) {
    updateSet.location = null;
  }

  if (!preserveUserRating) {
    if (candidate.diemTrungBinh !== undefined) {
      updateSet.diemTrungBinh = candidate.diemTrungBinh;
    }
    if (candidate.rawRating !== undefined) {
      updateSet.rawRating = candidate.rawRating;
    }
    updateSet.ratingScale = candidate.ratingScale;
    updateSet._ratingNormalized = candidate._ratingNormalized;
  }

  if (candidate.diemKhongGian !== undefined) {
    updateSet.diemKhongGian = candidate.diemKhongGian;
  }
  if (candidate.diemViTri !== undefined) {
    updateSet.diemViTri = candidate.diemViTri;
  }
  if (candidate.diemChatLuong !== undefined) {
    updateSet.diemChatLuong = candidate.diemChatLuong;
  }
  if (candidate.diemPhucVu !== undefined) {
    updateSet.diemPhucVu = candidate.diemPhucVu;
  }
  if (candidate.diemGiaCa !== undefined) {
    updateSet.diemGiaCa = candidate.diemGiaCa;
  }
  if (candidate.foodyReviewsCount !== undefined) {
    updateSet.foodyReviewsCount = candidate.foodyReviewsCount;
  }

  if (candidate.giaCa) updateSet.giaCa = candidate.giaCa;
  if (candidate.gioMoCua) updateSet.gioMoCua = candidate.gioMoCua;
  if (candidate.tags) updateSet.tags = candidate.tags;
  if (candidate.avatarUrl) updateSet.avatarUrl = candidate.avatarUrl;
  if (candidate.urlGoc) updateSet.urlGoc = candidate.urlGoc;
  if (candidate.slug) updateSet.slug = candidate.slug;
  if (candidate.contactPhone) updateSet.contactPhone = candidate.contactPhone;

  const simulatedPostDoc: Record<string, unknown> = {
    ...existingDoc,
    ...updateSet,
  };
  const postDigest = computeTrackedDocumentDigest(simulatedPostDoc);
  updateSet.ingestionPostDigest = postDigest;

  // Never overwrite ownerId, native reviewsCount, isVerified, isFeatured, or createdAt.
  return { updateSet, nextRevision, postDigest };
}

const TARGETED_LOOKUP_PROJECTION = {
  _id: 1,
  externalSource: 1,
  externalSourceId: 1,
  tenQuan: 1,
  diaChi: 1,
  cityId: 1,
  lat: 1,
  lon: 1,
  location: 1,
  diemTrungBinh: 1,
  rawRating: 1,
  ratingScale: 1,
  _ratingNormalized: 1,
  diemKhongGian: 1,
  diemViTri: 1,
  diemChatLuong: 1,
  diemPhucVu: 1,
  diemGiaCa: 1,
  foodyReviewsCount: 1,
  giaCa: 1,
  gioMoCua: 1,
  tags: 1,
  avatarUrl: 1,
  urlGoc: 1,
  slug: 1,
  contactPhone: 1,
  status: 1,
  reviewsCount: 1,
  ownerId: 1,
  isVerified: 1,
  isFeatured: 1,
  ingestionBatchId: 1,
  ingestionRevision: 1,
  ingestionPostDigest: 1,
  normalizedNameAddressKey: 1,
  createdAt: 1,
  updatedAt: 1,
} as const;

const LOOKUP_CHUNK_SIZE = 50;
const MAX_RESULTS_PER_CHUNK_FACTOR = 4;

/**
 * Fetches potentially matching restaurant documents using index-aligned exact equality
 * predicates (compound `(externalSource, externalSourceId)`, `slug`, `urlGoc`,
 * `normalizedNameAddressKey`, and compound exact `(tenQuan, diaChi)`), avoiding
 * broad regex scans and bounding per-chunk result cardinality.
 */
async function fetchTargetedMatchingRestaurants(
  restaurantsCol: Collection<RestaurantDocRecord>,
  candidates: readonly NormalizedRestaurantCandidate[],
  resultsPerChunkFactor: number = MAX_RESULTS_PER_CHUNK_FACTOR,
): Promise<RestaurantDocRecord[]> {
  if (!Number.isInteger(resultsPerChunkFactor) || resultsPerChunkFactor < 1) {
    throw new IngestionValidationError(
      `Invalid maxDedupResultsPerChunkFactor=${String(resultsPerChunkFactor)}: expected integer >= 1.`,
    );
  }
  if (candidates.length === 0) {
    return [];
  }

  const byDocId = new Map<string, RestaurantDocRecord>();

  for (let i = 0; i < candidates.length; i += LOOKUP_CHUNK_SIZE) {
    const chunk = candidates.slice(i, i + LOOKUP_CHUNK_SIZE);
    const orClauses: Array<Record<string, unknown>> = [];

    // 1. Compound (externalSource, externalSourceId) exact pairs (uses compound unique index)
    const seenTier1 = new Set<string>();
    for (const cand of chunk) {
      const pairKey = `${cand.externalSource}::${cand.externalSourceId}`;
      if (!seenTier1.has(pairKey)) {
        seenTier1.add(pairKey);
        orClauses.push({
          externalSource: cand.externalSource,
          externalSourceId: cand.externalSourceId,
        });
      }
    }

    // 2. Canonical slug lookup (uses sparse slug index)
    const slugs = Array.from(
      new Set(chunk.map((c) => normalizeMatchKey(c.slug)).filter(Boolean)),
    );
    if (slugs.length > 0) {
      orClauses.push({ slug: { $in: slugs } });
    }

    // 3. Canonical URL lookup (uses sparse urlGoc index)
    const urlVariants = Array.from(
      new Set(
        chunk.flatMap((c) => {
          const base = c.urlGoc.trim().replace(/\/+$/, '');
          return base ? [base, `${base}/`] : [];
        }),
      ),
    );
    if (urlVariants.length > 0) {
      orClauses.push({ urlGoc: { $in: urlVariants } });
    }

    // 4. Normalized name+address key + legacy exact compound (tenQuan, diaChi) pairs
    const nameAddrKeys = Array.from(
      new Set(
        chunk
          .map((c) => computeNameAddressKey(c.tenQuan, c.diaChi))
          .filter(Boolean),
      ),
    );
    if (nameAddrKeys.length > 0) {
      orClauses.push({ normalizedNameAddressKey: { $in: nameAddrKeys } });
    }

    const seenExactNameAddr = new Set<string>();
    for (const cand of chunk) {
      if (cand.tenQuan && cand.diaChi) {
        const key = `${cand.tenQuan}::${cand.diaChi}`;
        if (!seenExactNameAddr.has(key)) {
          seenExactNameAddr.add(key);
          orClauses.push({ tenQuan: cand.tenQuan, diaChi: cand.diaChi });
        }
      }
    }

    if (orClauses.length === 0) {
      continue;
    }

    const chunkLimit = chunk.length * resultsPerChunkFactor;
    const cursor = restaurantsCol.find(
      { $or: orClauses },
      { projection: TARGETED_LOOKUP_PROJECTION },
    );
    const boundedCursor =
      typeof (cursor as { limit?: (n: number) => unknown }).limit === 'function'
        ? (
            cursor as {
              limit: (n: number) => {
                toArray: () => Promise<RestaurantDocRecord[]>;
              };
            }
          ).limit(chunkLimit + 1)
        : cursor;

    const docs = await boundedCursor.toArray();
    if (docs.length > chunkLimit) {
      throw new IngestionValidationError(
        `Deduplication lookup overflow for chunk starting at index ${i} (${chunk.length} candidates): fetched ${docs.length} docs exceeding chunk limit ${chunkLimit}. Refusing to proceed with an incomplete deduplication result set.`,
      );
    }

    for (const doc of docs) {
      byDocId.set(String(doc._id), doc);
    }
  }

  return Array.from(byDocId.values());
}

/**
 * Executes the M10.2.1 hardened ingestion pipeline:
 * Batch Uniqueness Guard -> Write-Ahead Pending Ledger -> Raw Staging
 * -> Validation & Normalization -> Targeted Deduplication
 * -> Idempotent Bulk Upsert -> Applied Ledger / Crash-Recovery State.
 */
export async function runRestaurantIngestionPipeline(
  db: Db,
  options: RunIngestionOptions,
): Promise<IngestionBatchSummary> {
  const mode: IngestionMode = options.mode || 'dry-run';
  if (mode !== 'dry-run' && mode !== 'apply') {
    throw new IngestionValidationError(
      `Unsupported mode "${mode}" for runRestaurantIngestionPipeline(): use rollbackIngestionBatch(), recoverIngestionBatch(), preflightExternalSourceUniqueIndex(), or rolloutIngestionIndexes().`,
    );
  }

  const dryRun = mode === 'dry-run';
  const now = options.now || new Date();
  const rawSource = options.source?.trim() || 'foody_shopeefood';
  const source = rawSource.toLowerCase();
  if (!isSupportedIngestionSource(source)) {
    const safeSource = redactSensitiveDiagnosticString(rawSource, 64);
    throw new IngestionValidationError(
      `Unsupported batch source "${safeSource}".`,
    );
  }
  const checksumSha256 = computeBatchChecksumSha256(options.rawContent);
  const batchId =
    options.batchId?.trim() || createIngestionBatchId(checksumSha256, now);

  const ledgerCol = db.collection<IngestionBatchLedgerDocument>(
    INGESTION_BATCHES_COLLECTION,
  );
  const existingLedger = await ledgerCol.findOne({
    $or: [{ _id: batchId }, { batchId }],
  });
  if (existingLedger) {
    const checksumMismatch = existingLedger.checksumSha256 !== checksumSha256;
    throw new IngestionValidationError(
      `Refusing to reuse batchId "${batchId}": existing ledger status is "${existingLedger.status}" (checksumMismatch=${String(checksumMismatch)}). Use a new unique batchId or run recovery if needed.`,
    );
  }

  const parsedRecords = parseRawIngestionInput(
    options.rawContent,
    options.format || 'auto',
  );
  const stagingDocs = buildRawStagingDocuments(parsedRecords, {
    batchId,
    checksumSha256,
    source,
    scrapedAt: now,
  });

  const validationErrors: IngestionValidationIssue[] = [];
  const warnings: IngestionValidationIssue[] = [];
  const infos: IngestionValidationIssue[] = [];
  const rejectedSample: RejectedRecordSample[] = [];
  const duplicateCandidateEntries: DuplicateCandidateEntry[] = [];
  const validOutcomes: Array<{
    outcome: RecordNormalizationOutcome;
    candidate: NormalizedRestaurantCandidate;
  }> = [];

  const metrics: IngestionQualityMetrics = {
    raw_scraped_count: parsedRecords.length,
    valid_record_count: 0,
    inserted_count: 0,
    matched_count: 0,
    updated_count: 0,
    rejected_count: 0,
    duplicate_count: 0,
    invalid_or_missing_coords_count: 0,
    rating_10pt_explicit_count: 0,
    rating_unrated_zero_count: 0,
    rating_ambiguous_count: 0,
    missing_tags_count: 0,
    missing_price_count: 0,
    missing_address_count: 0,
  };

  for (const parsed of parsedRecords) {
    const outcome = validateAndNormalizeRestaurantRecord(
      parsed,
      batchId,
      source,
    );

    if (!outcome.candidate) {
      metrics.rejected_count += 1;
      validationErrors.push(...outcome.errors);
      warnings.push(...outcome.warnings);
      infos.push(...outcome.infos);
      if (rejectedSample.length < MAX_REJECTED_SAMPLE_RECORDS) {
        rejectedSample.push({
          recordIndex: parsed.recordIndex,
          sourceId: outcome.errors[0]?.sourceId,
          errors: outcome.errors,
          rawPreview: sanitizeRawPreview({
            RestaurantID: parsed.payload.RestaurantID,
            Name: parsed.payload.Name ?? parsed.payload.tenQuan,
          }),
        });
      }
      continue;
    }

    validOutcomes.push({ outcome, candidate: outcome.candidate });
  }

  // Deterministic intra-batch deduplication (Tier 1 -> Tier 2 -> Tier 3)
  const seenTier1 = new Set<string>();
  const seenSlugs = new Set<string>();
  const seenUrls = new Set<string>();
  const seenNameAddr = new Set<string>();
  const deduplicatedCandidates: NormalizedRestaurantCandidate[] = [];

  for (const { outcome, candidate: cand } of validOutcomes) {
    const tier1Key = `${cand.externalSource}::${cand.externalSourceId}`;
    const slugKey = normalizeMatchKey(cand.slug);
    const urlKey = normalizeUrlKey(cand.urlGoc);
    const nameAddrKey =
      cand.tenQuan && cand.diaChi
        ? `${normalizeMatchKey(cand.tenQuan)}::${normalizeMatchKey(cand.diaChi)}`
        : '';

    const isDup =
      seenTier1.has(tier1Key) ||
      (slugKey.length > 0 && seenSlugs.has(slugKey)) ||
      (urlKey.length > 0 && seenUrls.has(urlKey)) ||
      (nameAddrKey.length > 0 && seenNameAddr.has(nameAddrKey));

    if (isDup) {
      metrics.duplicate_count += 1;
      duplicateCandidateEntries.push({
        recordIndex: cand.recordIndex,
        externalSource: cand.externalSource,
        externalSourceId: cand.externalSourceId,
        tenQuan: cand.tenQuan,
        matchType: 'intra_batch',
      });
      warnings.push({
        recordIndex: cand.recordIndex,
        field: 'RestaurantID/slug/name+address',
        errorCode: 'DUPLICATE_IN_BATCH',
        reason: `Skipped duplicate record in batch (${tier1Key}).`,
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
    if (outcome.invalidOrMissingCoords) {
      metrics.invalid_or_missing_coords_count += 1;
    }
    if (outcome.ratingKind === '10_point') {
      metrics.rating_10pt_explicit_count += 1;
    } else if (outcome.ratingKind === 'unrated_zero') {
      metrics.rating_unrated_zero_count += 1;
    } else if (outcome.ratingKind === 'ambiguous') {
      metrics.rating_ambiguous_count += 1;
    }
    if (outcome.missingTags) {
      metrics.missing_tags_count += 1;
    }
    if (outcome.missingPrice) {
      metrics.missing_price_count += 1;
    }
    if (outcome.missingAddress) {
      metrics.missing_address_count += 1;
    }

    deduplicatedCandidates.push(cand);
  }

  metrics.valid_record_count = deduplicatedCandidates.length;

  // Resolve existing DB matches via targeted indexed queries (no full-collection scan)
  const restaurantsCol = db.collection<RestaurantDocRecord>(
    RESTAURANTS_COLLECTION,
  );
  const existingDocs = await fetchTargetedMatchingRestaurants(
    restaurantsCol,
    deduplicatedCandidates,
    options.maxDedupResultsPerChunkFactor,
  );

  const existingByTier1 = new Map<string, RestaurantDocRecord>();
  const existingBySlug = new Map<string, RestaurantDocRecord>();
  const existingByUrl = new Map<string, RestaurantDocRecord>();
  const existingByNameAddr = new Map<string, RestaurantDocRecord>();

  for (const doc of existingDocs) {
    const extSrc =
      typeof doc.externalSource === 'string' && doc.externalSource
        ? doc.externalSource
        : source;
    if (
      typeof doc.externalSourceId === 'string' &&
      doc.externalSourceId.trim()
    ) {
      existingByTier1.set(`${extSrc}::${doc.externalSourceId.trim()}`, doc);
    }
    const slugKey = normalizeMatchKey(doc.slug);
    if (slugKey) {
      existingBySlug.set(slugKey, doc);
    }
    const urlKey = normalizeUrlKey(doc.urlGoc);
    if (urlKey) {
      existingByUrl.set(urlKey, doc);
    }
    const nKey = normalizeMatchKey(doc.tenQuan);
    const aKey = normalizeMatchKey(doc.diaChi);
    if (nKey && aKey) {
      existingByNameAddr.set(`${nKey}::${aKey}`, doc);
    }
  }

  const bulkOps: AnyBulkWriteOperation<RestaurantDocRecord>[] = [];
  const insertedIds: ObjectId[] = [];
  const insertedRecords: IngestionInsertedRecordBackup[] = [];
  const updatedBackups: IngestionUpdatedBackup[] = [];
  let plannedInserts = 0;
  let plannedUpdates = 0;

  for (const cand of deduplicatedCandidates) {
    const tier1Key = `${cand.externalSource}::${cand.externalSourceId}`;
    const slugKey = normalizeMatchKey(cand.slug);
    const urlKey = normalizeUrlKey(cand.urlGoc);
    const nameAddrKey =
      cand.tenQuan && cand.diaChi
        ? `${normalizeMatchKey(cand.tenQuan)}::${normalizeMatchKey(cand.diaChi)}`
        : '';

    const existing =
      existingByTier1.get(tier1Key) ||
      (slugKey ? existingBySlug.get(slugKey) : undefined) ||
      (urlKey ? existingByUrl.get(urlKey) : undefined) ||
      (nameAddrKey ? existingByNameAddr.get(nameAddrKey) : undefined);

    if (existing) {
      plannedUpdates += 1;
      duplicateCandidateEntries.push({
        recordIndex: cand.recordIndex,
        externalSource: cand.externalSource,
        externalSourceId: cand.externalSourceId,
        tenQuan: cand.tenQuan,
        matchType: 'existing_db_candidate',
        matchedDocId: String(existing._id),
      });
      const { updateSet, nextRevision, postDigest } = buildSafeUpdateSetPayload(
        cand,
        existing,
        now,
      );
      updatedBackups.push(
        extractBackupFields(existing, updateSet, now, nextRevision, postDigest),
      );
      bulkOps.push({
        updateOne: {
          filter: { _id: existing._id },
          update: { $set: updateSet },
          upsert: false,
        },
      });
    } else {
      plannedInserts += 1;
      const newDoc = buildInsertRestaurantDoc(cand, now);
      insertedIds.push(newDoc._id);
      insertedRecords.push({
        docId: newDoc._id,
        postIngestionDigest:
          typeof newDoc.ingestionPostDigest === 'string'
            ? newDoc.ingestionPostDigest
            : computeTrackedDocumentDigest(newDoc),
        expectedPostUpdatedAt: now,
        expectedPostRevision: 1,
      });
      bulkOps.push({
        insertOne: {
          document: newDoc,
        },
      });
    }
  }

  const dataQualityReport = buildDataQualityReport({
    totalInputRecords: parsedRecords.length,
    validRecords: deduplicatedCandidates.length,
    rejectedRecords: metrics.rejected_count,
    errors: validationErrors,
    warnings,
    infos,
    duplicateCandidates: duplicateCandidateEntries,
    rejectedSample,
  });

  if (dryRun) {
    return {
      batchId,
      mode,
      source,
      targetDb: options.targetDb || db.databaseName,
      targetUriRedacted: options.targetUriRedacted || 'local',
      checksumSha256,
      rawStagedCount: 0,
      plannedInserts,
      plannedUpdates,
      duplicatesSkipped: metrics.duplicate_count,
      metrics,
      validationErrors,
      warnings,
      dataQualityReport,
    };
  }

  // Write-ahead persistence: insert `pending` ledger BEFORE mutating `restaurants`.
  // Fails fast via atomic _id uniqueness if batchId already exists concurrently.
  const pendingLedger: IngestionBatchLedgerDocument = {
    _id: batchId,
    batchId,
    source,
    checksumSha256,
    status: 'pending',
    targetDb: options.targetDb || db.databaseName,
    collection: RESTAURANTS_COLLECTION,
    startedAt: now,
    appliedAt: null,
    failedAt: null,
    rolledBackAt: null,
    failureStage: null,
    error: null,
    metrics: { ...metrics },
    insertedIds,
    insertedRecords,
    updatedBackups,
    rolledBackDocIds: [],
  };

  await ledgerCol.insertOne(pendingLedger);

  let rawStagedCount = 0;
  try {
    rawStagedCount = await stageRawIngestionRecords(db, stagingDocs, {
      dryRun: false,
    });
  } catch (err) {
    await markLedgerFailureBestEffort(
      ledgerCol,
      batchId,
      'failed',
      'staging',
      err,
    );
    throw err;
  }

  try {
    if (bulkOps.length > 0) {
      const bulkResult = await restaurantsCol.bulkWrite(bulkOps, {
        ordered: false,
      });
      metrics.inserted_count = bulkResult.insertedCount;
      metrics.matched_count = bulkResult.matchedCount;
      metrics.updated_count = bulkResult.modifiedCount;
    }
  } catch (err) {
    const touchedIds = [
      ...insertedIds,
      ...updatedBackups.map((backup) => backup.docId),
    ];
    let anyLanded = 0;
    if (touchedIds.length > 0) {
      try {
        const landedDocs = await restaurantsCol
          .find(
            { _id: { $in: touchedIds }, ingestionBatchId: batchId },
            { projection: { _id: 1 } },
          )
          .toArray();
        anyLanded = landedDocs.length;
      } catch {
        anyLanded = 1; // Conservative: require recovery check when probe fails
      }
    }
    const nextStatus = anyLanded > 0 ? 'recovery_required' : 'failed';
    await markLedgerFailureBestEffort(
      ledgerCol,
      batchId,
      nextStatus,
      'restaurant_write',
      err,
    );
    throw err;
  }

  try {
    await ledgerCol.updateOne(
      { _id: batchId, status: 'pending' },
      {
        $set: {
          status: 'applied',
          appliedAt: new Date(),
          failureStage: null,
          error: null,
          metrics,
        },
      },
    );
  } catch (err) {
    await markLedgerFailureBestEffort(
      ledgerCol,
      batchId,
      'recovery_required',
      'ledger_finalize',
      err,
    );
    throw err;
  }

  return {
    batchId,
    mode,
    source,
    targetDb: options.targetDb || db.databaseName,
    targetUriRedacted: options.targetUriRedacted || 'local',
    checksumSha256,
    rawStagedCount,
    plannedInserts,
    plannedUpdates,
    duplicatesSkipped: metrics.duplicate_count,
    metrics,
    validationErrors,
    warnings,
    dataQualityReport,
  };
}

async function markLedgerFailureBestEffort(
  ledgerCol: Collection<IngestionBatchLedgerDocument>,
  batchId: string,
  status: 'failed' | 'recovery_required',
  failureStage: 'staging' | 'restaurant_write' | 'ledger_finalize',
  err: unknown,
): Promise<void> {
  try {
    await ledgerCol.updateOne(
      { _id: batchId },
      {
        $set: {
          status,
          failedAt: new Date(),
          failureStage,
          error: {
            name: err instanceof Error ? err.name : 'Error',
            message: err instanceof Error ? err.message : String(err),
          },
        },
      },
    );
  } catch {
    // Best-effort only: pending ledger already holds recovery metadata.
  }
}

function normalizeInsertedRecords(
  ledger: IngestionBatchLedgerDocument,
): IngestionInsertedRecordBackup[] {
  if (
    Array.isArray(ledger.insertedRecords) &&
    ledger.insertedRecords.length > 0
  ) {
    return ledger.insertedRecords;
  }
  return (ledger.insertedIds || []).map((docId) => ({
    docId,
    postIngestionDigest: '',
    expectedPostUpdatedAt: ledger.appliedAt || ledger.startedAt,
    expectedPostRevision: 1,
  }));
}

/**
 * Builds an atomic MongoDB Compare-And-Set filter matching exact post-ingestion
 * protected fields, revision/digest tokens, and every tracked catalog field from the
 * verified snapshot so concurrent writes between pre-check and final mutation fail cleanly.
 */
function buildAtomicCasFilter(
  verifiedDoc: RestaurantDocRecord,
  options: {
    batchId: string;
    expectedUpdatedAt: Date;
    expectedRevision: number;
    expectedPostDigest: string;
    expectedOwnerId: ObjectId | string | null;
    expectedReviewsCount: number;
    expectedIsVerified: boolean;
    expectedIsFeatured: boolean;
  },
): Record<string, unknown> {
  const andConditions: Array<Record<string, unknown>> = [];

  if (options.expectedOwnerId === null) {
    andConditions.push({ ownerId: { $exists: false } });
  } else {
    andConditions.push({ ownerId: options.expectedOwnerId });
  }

  if (options.expectedReviewsCount === 0) {
    andConditions.push({
      $or: [{ reviewsCount: 0 }, { reviewsCount: { $exists: false } }],
    });
  } else {
    andConditions.push({ reviewsCount: options.expectedReviewsCount });
  }

  if (!options.expectedIsVerified) {
    andConditions.push({
      $or: [{ isVerified: false }, { isVerified: { $exists: false } }],
    });
  } else {
    andConditions.push({ isVerified: true });
  }

  if (!options.expectedIsFeatured) {
    andConditions.push({
      $or: [{ isFeatured: false }, { isFeatured: { $exists: false } }],
    });
  } else {
    andConditions.push({ isFeatured: true });
  }

  const filter: Record<string, unknown> = {
    _id: verifiedDoc._id,
    ingestionBatchId: options.batchId,
    updatedAt: options.expectedUpdatedAt,
    $and: andConditions,
  };

  if (
    verifiedDoc.ingestionRevision !== undefined ||
    options.expectedRevision > 0
  ) {
    filter.ingestionRevision = options.expectedRevision;
  }

  if (
    typeof verifiedDoc.ingestionPostDigest === 'string' &&
    options.expectedPostDigest
  ) {
    filter.ingestionPostDigest = options.expectedPostDigest;
  }

  for (const key of BACKUP_TRACKED_KEYS) {
    if (key === 'updatedAt') {
      continue;
    }
    const val = verifiedDoc[key];
    if (val !== undefined) {
      filter[key] = val;
    } else {
      filter[key] = { $exists: false };
    }
  }

  return filter;
}

async function executeCompareAndSetRollback(
  db: Db,
  ledger: IngestionBatchLedgerDocument,
  options: { dryRun: boolean; allowIncompleteStates: boolean },
): Promise<{
  deletedInsertedCount: number;
  restoredUpdatedCount: number;
  skippedUserOwnedOrModifiedCount: number;
  missingDocumentsCount: number;
  conflicts: IngestionRollbackConflict[];
  newlyRolledBackIds: ObjectId[];
  hasBlockingConflict: boolean;
}> {
  const restaurantsCol = db.collection<RestaurantDocRecord>(
    RESTAURANTS_COLLECTION,
  );
  const alreadyRolledBack = new Set(
    (ledger.rolledBackDocIds || []).map((id) => String(id)),
  );

  const insertedRecords = normalizeInsertedRecords(ledger).filter(
    (r) => !alreadyRolledBack.has(String(r.docId)),
  );
  const updatedBackups = (ledger.updatedBackups || []).filter(
    (b) => !alreadyRolledBack.has(String(b.docId)),
  );

  const targetIds = [
    ...insertedRecords.map((r) => r.docId),
    ...updatedBackups.map((b) => b.docId),
  ];

  const currentDocs =
    targetIds.length > 0
      ? ((await restaurantsCol
          .find(
            { _id: { $in: targetIds } },
            { projection: TARGETED_LOOKUP_PROJECTION },
          )
          .toArray()) as RestaurantDocRecord[])
      : [];

  const currentMap = new Map<string, RestaurantDocRecord>(
    currentDocs.map((d) => [String(d._id), d]),
  );

  let deletedInsertedCount = 0;
  let restoredUpdatedCount = 0;
  let skippedUserOwnedOrModifiedCount = 0;
  let missingDocumentsCount = 0;
  const conflicts: IngestionRollbackConflict[] = [];
  const newlyRolledBackIds: ObjectId[] = [];
  let hasBlockingConflict = false;

  // Verify and delete batch-inserted records using CAS
  for (const rec of insertedRecords) {
    const idStr = String(rec.docId);
    const current = currentMap.get(idStr);

    if (!current) {
      missingDocumentsCount += 1;
      conflicts.push({
        docId: idStr,
        operation: 'delete_insert',
        reasonCode: 'DOCUMENT_MISSING',
        reason: `Inserted document ${idStr} is already missing from ${RESTAURANTS_COLLECTION}.`,
      });
      newlyRolledBackIds.push(rec.docId);
      continue;
    }

    const currentBatch =
      typeof current.ingestionBatchId === 'string'
        ? current.ingestionBatchId
        : null;
    const userOwnedModified =
      current.ownerId !== undefined ||
      (typeof current.reviewsCount === 'number' && current.reviewsCount > 0) ||
      Boolean(current.isVerified) ||
      Boolean(current.isFeatured);

    if (userOwnedModified) {
      skippedUserOwnedOrModifiedCount += 1;
      hasBlockingConflict = true;
      conflicts.push({
        docId: idStr,
        operation: 'delete_insert',
        reasonCode: 'USER_OWNED_MODIFIED',
        reason:
          'Inserted document acquired user-owned or verified fields (ownerId/reviewsCount/isVerified/isFeatured); refusing deletion.',
        currentIngestionBatchId: currentBatch,
      });
      continue;
    }

    if (currentBatch !== ledger.batchId) {
      skippedUserOwnedOrModifiedCount += 1;
      hasBlockingConflict = true;
      conflicts.push({
        docId: idStr,
        operation: 'delete_insert',
        reasonCode: 'OVERLAPPING_BATCH_CONFLICT',
        reason: `Document was subsequently modified by batch "${String(currentBatch)}"; roll back overlapping batches in reverse (LIFO) order first.`,
        currentIngestionBatchId: currentBatch,
      });
      continue;
    }

    const currentDigest = computeTrackedDocumentDigest(current);
    if (
      (rec.postIngestionDigest && currentDigest !== rec.postIngestionDigest) ||
      (typeof current.ingestionPostDigest === 'string' &&
        rec.postIngestionDigest &&
        current.ingestionPostDigest !== rec.postIngestionDigest) ||
      (typeof current.ingestionRevision === 'number' &&
        rec.expectedPostRevision > 0 &&
        current.ingestionRevision !== rec.expectedPostRevision)
    ) {
      skippedUserOwnedOrModifiedCount += 1;
      hasBlockingConflict = true;
      conflicts.push({
        docId: idStr,
        operation: 'delete_insert',
        reasonCode: 'MODIFIED_AFTER_BATCH',
        reason: `Post-ingestion state digest/revision mismatch on document ${idStr}; refusing blind deletion.`,
        currentIngestionBatchId: currentBatch,
      });
      continue;
    }

    if (options.dryRun) {
      deletedInsertedCount += 1;
      continue;
    }

    const casDeleteFilter = buildAtomicCasFilter(current, {
      batchId: ledger.batchId,
      expectedUpdatedAt: rec.expectedPostUpdatedAt,
      expectedRevision: rec.expectedPostRevision ?? 1,
      expectedPostDigest: rec.postIngestionDigest,
      expectedOwnerId: null,
      expectedReviewsCount: 0,
      expectedIsVerified: false,
      expectedIsFeatured: false,
    });

    const delRes = await restaurantsCol.deleteOne(casDeleteFilter);

    if (delRes.deletedCount === 1) {
      deletedInsertedCount += 1;
      newlyRolledBackIds.push(rec.docId);
    } else {
      skippedUserOwnedOrModifiedCount += 1;
      hasBlockingConflict = true;
      conflicts.push({
        docId: idStr,
        operation: 'delete_insert',
        reasonCode: 'CAS_WRITE_MISMATCH',
        reason: `Concurrent modification prevented compare-and-set delete of ${idStr}.`,
        currentIngestionBatchId: currentBatch,
      });
    }
  }

  // Verify and restore batch-updated records using CAS
  for (const backup of updatedBackups) {
    const idStr = String(backup.docId);
    const current = currentMap.get(idStr);

    if (!current) {
      if (options.allowIncompleteStates) {
        // Under incomplete batch recovery, an updated backup doc might simply never have existed/been deleted
      }
      missingDocumentsCount += 1;
      conflicts.push({
        docId: idStr,
        operation: 'restore_update',
        reasonCode: 'DOCUMENT_MISSING',
        reason: `Updated document ${idStr} is missing from ${RESTAURANTS_COLLECTION}; cannot restore.`,
      });
      newlyRolledBackIds.push(backup.docId);
      continue;
    }

    const currentBatch =
      typeof current.ingestionBatchId === 'string'
        ? current.ingestionBatchId
        : null;
    const currentReviewsCount =
      typeof current.reviewsCount === 'number' &&
      Number.isFinite(current.reviewsCount)
        ? current.reviewsCount
        : 0;

    const protectedChanged =
      !sameOptionalObjectId(current.ownerId, backup.expectedOwnerId) ||
      currentReviewsCount !== backup.expectedReviewsCount ||
      Boolean(current.isVerified) !== backup.expectedIsVerified ||
      Boolean(current.isFeatured) !== backup.expectedIsFeatured;

    if (protectedChanged) {
      skippedUserOwnedOrModifiedCount += 1;
      hasBlockingConflict = true;
      conflicts.push({
        docId: idStr,
        operation: 'restore_update',
        reasonCode: 'USER_OWNED_MODIFIED',
        reason:
          'User-owned or system-owned fields (ownerId/reviewsCount/isVerified/isFeatured) changed after ingestion; refusing overwrite.',
        currentIngestionBatchId: currentBatch,
      });
      continue;
    }

    if (currentBatch !== ledger.batchId) {
      skippedUserOwnedOrModifiedCount += 1;
      hasBlockingConflict = true;
      conflicts.push({
        docId: idStr,
        operation: 'restore_update',
        reasonCode: 'OVERLAPPING_BATCH_CONFLICT',
        reason: `Document was subsequently modified by batch "${String(currentBatch)}"; roll back overlapping batches in reverse (LIFO) order first.`,
        currentIngestionBatchId: currentBatch,
      });
      continue;
    }

    const currentDigest = computeTrackedDocumentDigest(current);
    if (
      (backup.postIngestionDigest &&
        currentDigest !== backup.postIngestionDigest) ||
      (typeof current.ingestionPostDigest === 'string' &&
        backup.postIngestionDigest &&
        current.ingestionPostDigest !== backup.postIngestionDigest) ||
      (typeof current.ingestionRevision === 'number' &&
        backup.expectedPostRevision > 0 &&
        current.ingestionRevision !== backup.expectedPostRevision)
    ) {
      skippedUserOwnedOrModifiedCount += 1;
      hasBlockingConflict = true;
      conflicts.push({
        docId: idStr,
        operation: 'restore_update',
        reasonCode: 'MODIFIED_AFTER_BATCH',
        reason: `Document ${idStr} was modified after batch "${ledger.batchId}"; refusing overwrite.`,
        currentIngestionBatchId: currentBatch,
      });
      continue;
    }

    if (options.dryRun) {
      restoredUpdatedCount += 1;
      continue;
    }

    const unsetFields: Record<string, ''> = {};
    for (const key of BACKUP_TRACKED_KEYS) {
      if (
        !(key in backup.previousFields) ||
        backup.previousFields[key] === undefined
      ) {
        unsetFields[key] = '';
      }
    }
    if (!backup.hadBatchIdBefore) {
      unsetFields.ingestionBatchId = '';
    }
    if (!backup.hadRevisionBefore) {
      unsetFields.ingestionRevision = '';
    }
    if (!backup.hadPostDigestBefore) {
      unsetFields.ingestionPostDigest = '';
    }

    const updateDoc: Record<string, unknown> = {};
    if (Object.keys(backup.previousFields).length > 0) {
      updateDoc.$set = backup.previousFields;
    }
    if (Object.keys(unsetFields).length > 0) {
      updateDoc.$unset = unsetFields;
    }

    const casUpdateFilter = buildAtomicCasFilter(current, {
      batchId: ledger.batchId,
      expectedUpdatedAt: backup.expectedPostUpdatedAt,
      expectedRevision: backup.expectedPostRevision ?? 1,
      expectedPostDigest: backup.postIngestionDigest,
      expectedOwnerId: backup.expectedOwnerId,
      expectedReviewsCount: backup.expectedReviewsCount,
      expectedIsVerified: backup.expectedIsVerified,
      expectedIsFeatured: backup.expectedIsFeatured,
    });

    const casRes = await restaurantsCol.updateOne(casUpdateFilter, updateDoc);

    if (casRes.matchedCount === 1) {
      restoredUpdatedCount += 1;
      newlyRolledBackIds.push(backup.docId);
    } else {
      skippedUserOwnedOrModifiedCount += 1;
      hasBlockingConflict = true;
      conflicts.push({
        docId: idStr,
        operation: 'restore_update',
        reasonCode: 'CAS_WRITE_MISMATCH',
        reason: `Concurrent modification prevented compare-and-set restore of ${idStr}.`,
        currentIngestionBatchId: currentBatch,
      });
    }
  }

  return {
    deletedInsertedCount,
    restoredUpdatedCount,
    skippedUserOwnedOrModifiedCount,
    missingDocumentsCount,
    conflicts,
    newlyRolledBackIds,
    hasBlockingConflict,
  };
}

/**
 * Safely rolls back ONLY unmodified records belonging to `batchId` using compare-and-set.
 * Never overwrites post-batch modifications or user-owned changes; enforces LIFO order on overlaps.
 */
export async function rollbackIngestionBatch(
  db: Db,
  batchId: string,
  options: { dryRun?: boolean } = {},
): Promise<IngestionRollbackResult> {
  const dryRun = options.dryRun === true;
  if (!batchId || batchId.trim().length === 0) {
    throw new IngestionValidationError(
      'A valid --rollback=<batchId> is required.',
    );
  }

  const trimmedId = batchId.trim();
  const ledgerCol = db.collection<IngestionBatchLedgerDocument>(
    INGESTION_BATCHES_COLLECTION,
  );
  const ledger = await ledgerCol.findOne({
    $or: [{ _id: trimmedId }, { batchId: trimmedId }],
  });
  if (!ledger) {
    throw new IngestionValidationError(
      `Ingestion batch "${trimmedId}" not found in "${INGESTION_BATCHES_COLLECTION}".`,
    );
  }

  if (ledger.status === 'rolled_back') {
    return {
      batchId: ledger.batchId,
      dryRun,
      status: 'already_rolled_back',
      deletedInsertedCount: 0,
      restoredUpdatedCount: 0,
      skippedUserOwnedOrModifiedCount: 0,
      missingDocumentsCount: 0,
      conflicts: [],
    };
  }

  if (
    ledger.status === 'pending' ||
    ledger.status === 'recovery_required' ||
    ledger.status === 'failed'
  ) {
    throw new IngestionValidationError(
      `Batch "${ledger.batchId}" has status "${ledger.status}". Run recoverIngestionBatch() (--recover=${ledger.batchId}) before rolling back.`,
    );
  }

  const outcome = await executeCompareAndSetRollback(db, ledger, {
    dryRun,
    allowIncompleteStates: false,
  });

  if (dryRun) {
    return {
      batchId: ledger.batchId,
      dryRun: true,
      status: outcome.hasBlockingConflict ? 'conflict' : 'dry_run_preview',
      deletedInsertedCount: outcome.deletedInsertedCount,
      restoredUpdatedCount: outcome.restoredUpdatedCount,
      skippedUserOwnedOrModifiedCount: outcome.skippedUserOwnedOrModifiedCount,
      missingDocumentsCount: outcome.missingDocumentsCount,
      conflicts: outcome.conflicts,
    };
  }

  const combinedRolledBack = [
    ...(ledger.rolledBackDocIds || []),
    ...outcome.newlyRolledBackIds,
  ];
  const nextStatus = outcome.hasBlockingConflict ? 'applied' : 'rolled_back';

  await ledgerCol.updateOne(
    { _id: ledger._id },
    {
      $set: {
        status: nextStatus,
        rolledBackDocIds: combinedRolledBack,
        ...(nextStatus === 'rolled_back' ? { rolledBackAt: new Date() } : {}),
      },
    },
  );

  return {
    batchId: ledger.batchId,
    dryRun: false,
    status: outcome.hasBlockingConflict ? 'conflict' : 'rolled_back',
    deletedInsertedCount: outcome.deletedInsertedCount,
    restoredUpdatedCount: outcome.restoredUpdatedCount,
    skippedUserOwnedOrModifiedCount: outcome.skippedUserOwnedOrModifiedCount,
    missingDocumentsCount: outcome.missingDocumentsCount,
    conflicts: outcome.conflicts,
  };
}

/**
 * Deterministically recovers or compensates an interrupted (`pending`, `recovery_required`,
 * or `failed`) ingestion batch on standalone MongoDB.
 */
export async function recoverIngestionBatch(
  db: Db,
  batchId: string,
  options: { action?: RecoveryAction; dryRun?: boolean } = {},
): Promise<IngestionRecoveryResult> {
  const dryRun = options.dryRun === true;
  const action: RecoveryAction = options.action || 'auto';
  if (!batchId || batchId.trim().length === 0) {
    throw new IngestionValidationError(
      'A valid --recover=<batchId> is required.',
    );
  }

  const trimmedId = batchId.trim();
  const ledgerCol = db.collection<IngestionBatchLedgerDocument>(
    INGESTION_BATCHES_COLLECTION,
  );
  const ledger = await ledgerCol.findOne({
    $or: [{ _id: trimmedId }, { batchId: trimmedId }],
  });
  if (!ledger) {
    throw new IngestionValidationError(
      `Ingestion batch "${trimmedId}" not found in "${INGESTION_BATCHES_COLLECTION}".`,
    );
  }

  if (ledger.status === 'applied' || ledger.status === 'rolled_back') {
    return {
      batchId: ledger.batchId,
      dryRun,
      previousStatus: ledger.status,
      finalStatus: ledger.status,
      actionTaken: 'no_action_needed',
      landedInsertedCount: 0,
      landedUpdatedCount: 0,
      deletedInsertedCount: 0,
      restoredUpdatedCount: 0,
      conflicts: [],
      standaloneLimitationNote: STANDALONE_MONGODB_LIMITATION_NOTE,
    };
  }

  const restaurantsCol = db.collection<RestaurantDocRecord>(
    RESTAURANTS_COLLECTION,
  );
  const insertedRecords = normalizeInsertedRecords(ledger);
  const updatedBackups = ledger.updatedBackups || [];
  const allTargetIds = [
    ...insertedRecords.map((r) => r.docId),
    ...updatedBackups.map((b) => b.docId),
  ];

  const landedDocs =
    allTargetIds.length > 0
      ? ((await restaurantsCol
          .find(
            { _id: { $in: allTargetIds }, ingestionBatchId: ledger.batchId },
            { projection: { _id: 1, updatedAt: 1 } },
          )
          .toArray()) as RestaurantDocRecord[])
      : [];
  const landedSet = new Set(landedDocs.map((d) => String(d._id)));

  const landedInsertedCount = insertedRecords.filter((r) =>
    landedSet.has(String(r.docId)),
  ).length;
  const landedUpdatedCount = updatedBackups.filter((b) =>
    landedSet.has(String(b.docId)),
  ).length;

  const allPlannedLanded =
    landedInsertedCount === insertedRecords.length &&
    landedUpdatedCount === updatedBackups.length;

  if (landedInsertedCount === 0 && landedUpdatedCount === 0) {
    if (!dryRun) {
      await ledgerCol.updateOne(
        { _id: ledger._id },
        {
          $set: {
            status: 'failed',
            failedAt: ledger.failedAt || new Date(),
          },
        },
      );
    }
    return {
      batchId: ledger.batchId,
      dryRun,
      previousStatus: ledger.status,
      finalStatus: dryRun ? ledger.status : 'failed',
      actionTaken: 'marked_failed_no_writes',
      landedInsertedCount: 0,
      landedUpdatedCount: 0,
      deletedInsertedCount: 0,
      restoredUpdatedCount: 0,
      conflicts: [],
      standaloneLimitationNote: STANDALONE_MONGODB_LIMITATION_NOTE,
    };
  }

  if (action === 'complete' || (action === 'auto' && allPlannedLanded)) {
    if (!allPlannedLanded) {
      throw new IngestionValidationError(
        `Cannot complete batch "${ledger.batchId}": only ${landedInsertedCount}/${insertedRecords.length} inserts and ${landedUpdatedCount}/${updatedBackups.length} updates landed. Use action="compensate".`,
      );
    }
    if (!dryRun) {
      await ledgerCol.updateOne(
        { _id: ledger._id },
        {
          $set: {
            status: 'applied',
            appliedAt: new Date(),
            failureStage: null,
            error: null,
            metrics: {
              ...ledger.metrics,
              inserted_count: landedInsertedCount,
              matched_count: landedUpdatedCount,
              updated_count: landedUpdatedCount,
            },
          },
        },
      );
    }
    return {
      batchId: ledger.batchId,
      dryRun,
      previousStatus: ledger.status,
      finalStatus: dryRun ? ledger.status : 'applied',
      actionTaken: 'completed_pending_apply',
      landedInsertedCount,
      landedUpdatedCount,
      deletedInsertedCount: 0,
      restoredUpdatedCount: 0,
      conflicts: [],
      standaloneLimitationNote: STANDALONE_MONGODB_LIMITATION_NOTE,
    };
  }

  // Compensate partial writes cleanly by building a scoped ledger covering only landed docs
  const landedInsertRecords = insertedRecords.filter((r) =>
    landedSet.has(String(r.docId)),
  );
  const landedUpdatedBackups = updatedBackups.filter((b) =>
    landedSet.has(String(b.docId)),
  );

  const compOutcome = await executeCompareAndSetRollback(
    db,
    {
      ...ledger,
      insertedRecords: landedInsertRecords,
      insertedIds: landedInsertRecords.map((r) => r.docId),
      updatedBackups: landedUpdatedBackups,
    },
    { dryRun, allowIncompleteStates: true },
  );

  const nextStatus = compOutcome.hasBlockingConflict
    ? 'recovery_required'
    : 'rolled_back';

  if (!dryRun) {
    const combinedRolledBack = [
      ...(ledger.rolledBackDocIds || []),
      ...compOutcome.newlyRolledBackIds,
    ];
    await ledgerCol.updateOne(
      { _id: ledger._id },
      {
        $set: {
          status: nextStatus,
          rolledBackDocIds: combinedRolledBack,
          ...(nextStatus === 'rolled_back'
            ? { rolledBackAt: new Date(), failureStage: null, error: null }
            : {}),
        },
      },
    );
  }

  return {
    batchId: ledger.batchId,
    dryRun,
    previousStatus: ledger.status,
    finalStatus: dryRun ? ledger.status : nextStatus,
    actionTaken: 'compensated_partial_writes',
    landedInsertedCount,
    landedUpdatedCount,
    deletedInsertedCount: compOutcome.deletedInsertedCount,
    restoredUpdatedCount: compOutcome.restoredUpdatedCount,
    conflicts: compOutcome.conflicts,
    standaloneLimitationNote: STANDALONE_MONGODB_LIMITATION_NOTE,
  };
}

export interface ControlledLocalIngestionOptions
  extends Omit<RunIngestionOptions, 'targetDb' | 'targetUriRedacted'> {
  env?: Record<string, string | undefined>;
  /** Optional injected Db instance for isolated unit testing without live sockets. */
  db?: Db;
}

/**
 * Controlled local ingestion entrypoint (M10.4):
 * - Defaults to `dry-run`.
 * - Enforces `GASTROWISE_ALLOW_LOCAL_INGESTION=true` before `apply` mode.
 * - Enforces local-only `gastro_core_test` target via `resolveIngestionDatabaseConfig()`.
 * - Reuses `runRestaurantIngestionPipeline()` (M10.2.1 + M10.3 data quality & staging).
 */
export async function executeControlledLocalIngestion(
  options: ControlledLocalIngestionOptions,
): Promise<IngestionBatchSummary> {
  const env = options.env ?? process.env;
  const mode: IngestionMode = options.mode || 'dry-run';
  if (mode !== 'dry-run' && mode !== 'apply') {
    throw new IngestionValidationError(
      `Unsupported mode "${mode}" for executeControlledLocalIngestion(): expected "dry-run" or "apply".`,
    );
  }

  if (mode === 'apply') {
    assertLocalIngestionApplyAllowed(env);
  }

  const config = resolveIngestionDatabaseConfig(env);

  if (options.db) {
    return runRestaurantIngestionPipeline(options.db, {
      ...options,
      mode,
      targetDb: config.dbName,
      targetUriRedacted: config.redactedUri,
    });
  }

  return withIngestionDatabase(
    (db, resolvedConfig) =>
      runRestaurantIngestionPipeline(db, {
        ...options,
        mode,
        targetDb: resolvedConfig.dbName,
        targetUriRedacted: resolvedConfig.redactedUri,
      }),
    env,
  );
}

export const DEFAULT_LEGACY_BACKFILL_BATCH_SIZE = 200 as const;

/**
 * Non-destructive dry-run / CAS backfill helper for legacy restaurant documents
 * missing `normalizedNameAddressKey`. Processes records in bounded `_id`-keyset batches
 * so large collections never materialize all documents into memory.
 * Defaults to `dryRun: true` and never modifies user-owned fields, catalog text, or deletes records.
 */
export async function backfillLegacyNormalizedKeys(
  db: Db,
  options: { dryRun?: boolean; batchSize?: number; limit?: number } = {},
): Promise<LegacyNormalizedKeyBackfillResult> {
  const dryRun = options.dryRun !== false;
  const batchSize =
    options.batchSize === undefined
      ? DEFAULT_LEGACY_BACKFILL_BATCH_SIZE
      : options.batchSize;

  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new IngestionValidationError(
      `Invalid backfill batchSize=${String(batchSize)}: expected integer >= 1.`,
    );
  }
  if (
    options.limit !== undefined &&
    (!Number.isInteger(options.limit) || options.limit < 1)
  ) {
    throw new IngestionValidationError(
      `Invalid backfill limit=${String(options.limit)}: expected integer >= 1.`,
    );
  }

  const restaurantsCol = db.collection<RestaurantDocRecord>(
    RESTAURANTS_COLLECTION,
  );
  const missingFilter: Record<string, unknown> = {
    $or: [
      { normalizedNameAddressKey: { $exists: false } },
      { normalizedNameAddressKey: null },
      { normalizedNameAddressKey: '' },
    ],
  };

  const scannedCount = await restaurantsCol.countDocuments({});

  let missingKeyCount = 0;
  let computableCount = 0;
  let uncomputableCount = 0;
  let updatedCount = 0;
  let skippedConcurrentOrAlreadySetCount = 0;
  let batchesProcessed = 0;
  let lastSeenId: ObjectId | string | undefined;
  const sampleMissingDocIds: string[] = [];

  while (true) {
    const remaining =
      options.limit !== undefined ? options.limit - missingKeyCount : batchSize;
    if (remaining <= 0) {
      break;
    }

    const fetchCount = Math.min(batchSize, remaining);
    const pageFilter: Record<string, unknown> =
      lastSeenId !== undefined
        ? { $and: [missingFilter, { _id: { $gt: lastSeenId } }] }
        : missingFilter;

    const cursor = restaurantsCol.find(pageFilter, {
      projection: {
        _id: 1,
        tenQuan: 1,
        diaChi: 1,
        normalizedNameAddressKey: 1,
      },
    });
    const sortedCursor =
      typeof (cursor as { sort?: (spec: Record<string, 1 | -1>) => unknown })
        .sort === 'function'
        ? (
            cursor as {
              sort: (spec: Record<string, 1 | -1>) => typeof cursor;
            }
          ).sort({ _id: 1 })
        : cursor;
    const boundedCursor =
      typeof (sortedCursor as { limit?: (n: number) => unknown }).limit ===
      'function'
        ? (
            sortedCursor as {
              limit: (n: number) => {
                toArray: () => Promise<RestaurantDocRecord[]>;
              };
            }
          ).limit(fetchCount)
        : sortedCursor;

    const batch = await boundedCursor.toArray();
    if (batch.length === 0) {
      break;
    }

    batchesProcessed += 1;
    lastSeenId = batch[batch.length - 1]._id;

    for (const doc of batch) {
      missingKeyCount += 1;
      const key = computeNameAddressKey(doc.tenQuan, doc.diaChi);
      if (!key) {
        uncomputableCount += 1;
        continue;
      }

      computableCount += 1;
      if (sampleMissingDocIds.length < 20) {
        sampleMissingDocIds.push(String(doc._id));
      }

      if (!dryRun) {
        const res = await restaurantsCol.updateOne(
          {
            _id: doc._id,
            ...missingFilter,
          },
          { $set: { normalizedNameAddressKey: key } },
        );
        if (res.modifiedCount > 0) {
          updatedCount += 1;
        } else {
          skippedConcurrentOrAlreadySetCount += 1;
        }
      }
    }

    if (batch.length < fetchCount) {
      break;
    }
  }

  return {
    collection: RESTAURANTS_COLLECTION,
    dryRun,
    batchSize,
    batchesProcessed,
    scannedCount,
    missingKeyCount,
    computableCount,
    uncomputableCount,
    updatedCount,
    skippedConcurrentOrAlreadySetCount,
    sampleMissingDocIds,
  };
}
