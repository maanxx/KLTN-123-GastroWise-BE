import { ObjectId } from 'mongodb';
import type { AnyBulkWriteOperation, Db } from 'mongodb';
import {
  INGESTION_BATCHES_COLLECTION,
  IngestionBatchLedgerDocument,
  IngestionBatchSummary,
  IngestionMode,
  IngestionQualityMetrics,
  IngestionRollbackResult,
  IngestionUpdatedBackup,
  IngestionValidationError,
  IngestionValidationIssue,
  NormalizedRestaurantCandidate,
  RESTAURANTS_COLLECTION,
} from './ingestion.types';
import {
  buildRawStagingDocuments,
  computeBatchChecksumSha256,
  createIngestionBatchId,
  parseRawIngestionInput,
  RawInputFormat,
  stageRawIngestionRecords,
} from './ingestion.staging';
import {
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
}

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
  'updatedAt',
] as const;

function extractBackupFields(
  existingDoc: RestaurantDocRecord,
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

  return {
    docId: existingDoc._id,
    hadBatchIdBefore,
    previousFields,
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
    createdAt: now,
    updatedAt: now,
  };

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

  return doc;
}

function buildSafeUpdateSetPayload(
  candidate: NormalizedRestaurantCandidate,
  existingDoc: RestaurantDocRecord,
  now: Date,
): Record<string, unknown> {
  const nativeReviewsCount =
    typeof existingDoc.reviewsCount === 'number' &&
    Number.isFinite(existingDoc.reviewsCount)
      ? existingDoc.reviewsCount
      : 0;
  const preserveUserRating = nativeReviewsCount > 0;

  const updateSet: Record<string, unknown> = {
    externalSource: candidate.externalSource,
    externalSourceId: candidate.externalSourceId,
    tenQuan: candidate.tenQuan,
    ingestionBatchId: candidate.ingestionBatchId,
    updatedAt: now,
  };

  if (candidate.diaChi) {
    updateSet.diaChi = candidate.diaChi;
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

  // Never overwrite ownerId, native reviewsCount, isVerified, isFeatured, or createdAt.
  return updateSet;
}

/**
 * Executes the M10.2 ingestion pipeline: Raw Staging -> Validation & Normalization
 * -> Deterministic Deduplication -> Idempotent Bulk Upsert (or Dry-Run Preview)
 * -> Quality Report & Rollback Ledger.
 */
export async function runRestaurantIngestionPipeline(
  db: Db,
  options: RunIngestionOptions,
): Promise<IngestionBatchSummary> {
  const mode: IngestionMode = options.mode || 'dry-run';
  if (mode === 'rollback') {
    throw new IngestionValidationError(
      'Use rollbackIngestionBatch() for rollback operations.',
    );
  }

  const dryRun = mode === 'dry-run';
  const now = options.now || new Date();
  const source = options.source || 'foody_shopeefood';
  const checksumSha256 = computeBatchChecksumSha256(options.rawContent);
  const batchId =
    options.batchId?.trim() || createIngestionBatchId(checksumSha256, now);

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

  const rawStagedCount = await stageRawIngestionRecords(db, stagingDocs, {
    dryRun,
  });

  const validationErrors: IngestionValidationIssue[] = [];
  const warnings: IngestionValidationIssue[] = [];
  const validOutcomes: Array<{
    outcome: RecordNormalizationOutcome;
    candidate: NormalizedRestaurantCandidate;
  }> = [];

  const metrics: IngestionQualityMetrics = {
    raw_scraped_count: parsedRecords.length,
    valid_record_count: 0,
    inserted_count: 0,
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
    const outcome = validateAndNormalizeRestaurantRecord(parsed, batchId);

    if (!outcome.candidate) {
      metrics.rejected_count += 1;
      validationErrors.push(...outcome.errors);
      warnings.push(...outcome.warnings);
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

  // Resolve existing DB matches across deduplicated candidates
  const restaurantsCol = db.collection<RestaurantDocRecord>(
    RESTAURANTS_COLLECTION,
  );
  const existingDocs = await restaurantsCol
    .find(
      {},
      {
        projection: {
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
          updatedAt: 1,
        },
      },
    )
    .toArray();

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
      updatedBackups.push(extractBackupFields(existing));
      const updateSet = buildSafeUpdateSetPayload(cand, existing, now);
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
      bulkOps.push({
        insertOne: {
          document: newDoc,
        },
      });
    }
  }

  if (!dryRun) {
    if (bulkOps.length > 0) {
      const bulkResult = await restaurantsCol.bulkWrite(bulkOps, {
        ordered: false,
      });
      metrics.inserted_count = bulkResult.insertedCount;
      metrics.updated_count = bulkResult.matchedCount;
    }

    const ledgerCol = db.collection<IngestionBatchLedgerDocument>(
      INGESTION_BATCHES_COLLECTION,
    );
    await ledgerCol.updateOne(
      { _id: batchId },
      {
        $set: {
          _id: batchId,
          batchId,
          source,
          checksumSha256,
          status: 'applied',
          targetDb: options.targetDb || db.databaseName,
          collection: RESTAURANTS_COLLECTION,
          appliedAt: now,
          rolledBackAt: null,
          metrics,
          insertedIds,
          updatedBackups,
        },
      },
      { upsert: true },
    );
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
  };
}

/**
 * Safely rolls back only the documents inserted or updated by `batchId` while
 * refusing to delete records that subsequently acquired a user owner or native reviews.
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

  const ledgerCol = db.collection<IngestionBatchLedgerDocument>(
    INGESTION_BATCHES_COLLECTION,
  );
  const ledger = await ledgerCol.findOne({ batchId: batchId.trim() });
  if (!ledger) {
    throw new IngestionValidationError(
      `Ingestion batch "${batchId}" not found in "${INGESTION_BATCHES_COLLECTION}".`,
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
    };
  }

  const restaurantsCol = db.collection<RestaurantDocRecord>(
    RESTAURANTS_COLLECTION,
  );

  // Only eligible for delete if created by this batch AND untouched by GastroWise users
  const eligibleDeleteDocs =
    ledger.insertedIds.length > 0
      ? await restaurantsCol
          .find(
            {
              _id: { $in: ledger.insertedIds },
              ingestionBatchId: ledger.batchId,
              ownerId: { $exists: false },
              $or: [{ reviewsCount: 0 }, { reviewsCount: { $exists: false } }],
            },
            { projection: { _id: 1 } },
          )
          .toArray()
      : [];

  const eligibleDeleteIds = eligibleDeleteDocs.map((d) => d._id);
  const skippedUserOwnedOrModifiedCount = Math.max(
    0,
    ledger.insertedIds.length - eligibleDeleteIds.length,
  );

  if (dryRun) {
    return {
      batchId: ledger.batchId,
      dryRun: true,
      status: 'dry_run_preview',
      deletedInsertedCount: eligibleDeleteIds.length,
      restoredUpdatedCount: ledger.updatedBackups.length,
      skippedUserOwnedOrModifiedCount,
    };
  }

  let deletedInsertedCount = 0;
  if (eligibleDeleteIds.length > 0) {
    const deleteRes = await restaurantsCol.deleteMany({
      _id: { $in: eligibleDeleteIds },
      ingestionBatchId: ledger.batchId,
    });
    deletedInsertedCount = deleteRes.deletedCount;
  }

  let restoredUpdatedCount = 0;
  if (ledger.updatedBackups.length > 0) {
    const restoreOps: AnyBulkWriteOperation<RestaurantDocRecord>[] =
      ledger.updatedBackups.map((backup) => {
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

        const updateDoc: Record<string, unknown> = {};
        if (Object.keys(backup.previousFields).length > 0) {
          updateDoc.$set = backup.previousFields;
        }
        if (Object.keys(unsetFields).length > 0) {
          updateDoc.$unset = unsetFields;
        }

        return {
          updateOne: {
            filter: { _id: backup.docId },
            update: updateDoc,
          },
        };
      });

    const restoreRes = await restaurantsCol.bulkWrite(restoreOps, {
      ordered: false,
    });
    restoredUpdatedCount = restoreRes.matchedCount;
  }

  await ledgerCol.updateOne(
    { _id: ledger._id },
    {
      $set: {
        status: 'rolled_back',
        rolledBackAt: new Date(),
      },
    },
  );

  return {
    batchId: ledger.batchId,
    dryRun: false,
    status: 'rolled_back',
    deletedInsertedCount,
    restoredUpdatedCount,
    skippedUserOwnedOrModifiedCount,
  };
}
