import type { ObjectId } from 'mongodb';
import type { GeoJsonPoint } from '../utils/geo.utils';
import type { RatingScaleKind } from '../utils/restaurant-normalizer.util';

export const EXTERNAL_SOURCE_FOODY = 'foody_shopeefood' as const;
export const SUPPORTED_INGESTION_SOURCES = [
  EXTERNAL_SOURCE_FOODY,
  'shopeefood',
  'foody',
  'partner_csv',
  'gastrowise',
] as const;
export const RAW_STAGING_COLLECTION = 'restaurants_raw_staging' as const;
export const INGESTION_BATCHES_COLLECTION = 'ingestion_batches' as const;
export const RESTAURANTS_COLLECTION = 'restaurants' as const;
export const APPROVED_INGESTION_DB_NAME = 'gastro_core_test' as const;

export type IngestionMode =
  | 'dry-run'
  | 'apply'
  | 'rollback'
  | 'recover'
  | 'preflight-indexes'
  | 'ensure-indexes';

export type IngestionBatchStatus =
  | 'pending'
  | 'applied'
  | 'failed'
  | 'rolled_back'
  | 'recovery_required';

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ParsedRawRecord {
  recordIndex: number;
  payload: Record<string, unknown>;
}

export interface RawStagingDocument {
  batchId: string;
  recordIndex: number;
  source: string;
  sourceId: string | null;
  sourceUrl: string | null;
  scrapedAt: Date;
  batchChecksumSha256: string;
  payload: Record<string, unknown>;
}

export interface IngestionValidationIssue {
  recordIndex: number;
  field: string;
  errorCode: string;
  reason: string;
  severity: ValidationSeverity;
  sourceId?: string;
  originalValue?: unknown;
}

export interface PreservedRawRestaurantFields {
  name?: string;
  address?: string;
  phone?: string;
  url?: string;
  avatarUrl?: string;
  rating?: unknown;
  reviewCount?: unknown;
  sourceMetadata?: Record<string, unknown>;
}

export interface NormalizedRestaurantCandidate {
  recordIndex: number;
  externalSource: string;
  externalSourceId: string;
  tenQuan: string;
  diaChi: string;
  cityId?: string;
  lat?: number;
  lon?: number;
  location: GeoJsonPoint | null;
  coordsValid: boolean;
  diemTrungBinh?: number;
  rawRating?: number;
  ratingScale: RatingScaleKind;
  _ratingNormalized: boolean;
  diemKhongGian?: number;
  diemViTri?: number;
  diemChatLuong?: number;
  diemPhucVu?: number;
  diemGiaCa?: number;
  foodyReviewsCount?: number;
  giaCa: string;
  gioMoCua: string;
  tags: string;
  avatarUrl: string;
  images?: string[];
  urlGoc: string;
  slug: string;
  contactPhone: string;
  status: 'open' | 'closed' | 'pending';
  ingestionBatchId: string;
  rawPreserved?: PreservedRawRestaurantFields;
}

export interface IngestionQualityMetrics {
  raw_scraped_count: number;
  valid_record_count: number;
  inserted_count: number;
  matched_count: number;
  updated_count: number;
  rejected_count: number;
  duplicate_count: number;
  invalid_or_missing_coords_count: number;
  rating_10pt_explicit_count: number;
  rating_unrated_zero_count: number;
  rating_ambiguous_count: number;
  missing_tags_count: number;
  missing_price_count: number;
  missing_address_count: number;
}

export interface IngestionInsertedRecordBackup {
  docId: ObjectId;
  postIngestionDigest: string;
  expectedPostUpdatedAt: Date;
  expectedPostRevision: number;
}

export interface IngestionUpdatedBackup {
  docId: ObjectId;
  hadBatchIdBefore: boolean;
  hadRevisionBefore: boolean;
  hadPostDigestBefore: boolean;
  previousFields: Record<string, unknown>;
  postIngestionDigest: string;
  expectedPostUpdatedAt: Date;
  expectedPostRevision: number;
  expectedOwnerId: ObjectId | string | null;
  expectedReviewsCount: number;
  expectedIsVerified: boolean;
  expectedIsFeatured: boolean;
}

export interface IngestionBatchErrorRecord {
  name: string;
  message: string;
}

export interface IngestionBatchLedgerDocument {
  _id: string;
  batchId: string;
  source: string;
  checksumSha256: string;
  status: IngestionBatchStatus;
  targetDb: string;
  collection: string;
  startedAt: Date;
  appliedAt: Date | null;
  failedAt: Date | null;
  rolledBackAt: Date | null;
  failureStage: 'staging' | 'restaurant_write' | 'ledger_finalize' | null;
  error: IngestionBatchErrorRecord | null;
  metrics: IngestionQualityMetrics;
  insertedIds: ObjectId[];
  insertedRecords: IngestionInsertedRecordBackup[];
  updatedBackups: IngestionUpdatedBackup[];
  rolledBackDocIds?: ObjectId[];
}

export type DataQualityStatus = 'PASSED' | 'PASSED_WITH_WARNINGS' | 'FAILED';

export interface DuplicateCandidateEntry {
  recordIndex: number;
  externalSource: string;
  externalSourceId: string;
  tenQuan: string;
  matchType: 'intra_batch' | 'existing_db_candidate';
  matchedDocId?: string;
}

export interface RejectedRecordSample {
  recordIndex: number;
  sourceId?: string;
  errors: IngestionValidationIssue[];
  rawPreview: Record<string, unknown>;
}

export interface ErrorCodeGroupSummary {
  errorCode: string;
  severity: ValidationSeverity;
  count: number;
}

export interface DataQualityReport {
  totalInputRecords: number;
  validRecords: number;
  rejectedRecords: number;
  warningRecords: number;
  infoRecords: number;
  duplicateCandidates: {
    intraBatchCount: number;
    existingDbCandidateCount: number;
    confirmedDuplicatesCount: number;
    totalCandidateCount: number;
    note: string;
    samples: DuplicateCandidateEntry[];
  };
  missingFieldCounts: Record<string, number>;
  invalidFieldCounts: Record<string, number>;
  issuesByErrorCode: ErrorCodeGroupSummary[];
  rejectedSample: RejectedRecordSample[];
  overallQualityStatus: DataQualityStatus;
}

export interface IngestionBatchSummary {
  batchId: string;
  mode: IngestionMode;
  source: string;
  targetDb: string;
  targetUriRedacted: string;
  checksumSha256: string;
  rawStagedCount: number;
  plannedInserts: number;
  plannedUpdates: number;
  duplicatesSkipped: number;
  metrics: IngestionQualityMetrics;
  validationErrors: IngestionValidationIssue[];
  warnings: IngestionValidationIssue[];
  dataQualityReport?: DataQualityReport;
}

export type RollbackConflictReasonCode =
  | 'DOCUMENT_MISSING'
  | 'MODIFIED_AFTER_BATCH'
  | 'OVERLAPPING_BATCH_CONFLICT'
  | 'USER_OWNED_MODIFIED'
  | 'CAS_WRITE_MISMATCH';

export interface IngestionRollbackConflict {
  docId: string;
  operation: 'delete_insert' | 'restore_update';
  reasonCode: RollbackConflictReasonCode;
  reason: string;
  currentIngestionBatchId?: string | null;
}

export interface IngestionRollbackResult {
  batchId: string;
  dryRun: boolean;
  status:
    | 'dry_run_preview'
    | 'rolled_back'
    | 'already_rolled_back'
    | 'conflict';
  deletedInsertedCount: number;
  restoredUpdatedCount: number;
  skippedUserOwnedOrModifiedCount: number;
  missingDocumentsCount: number;
  conflicts: IngestionRollbackConflict[];
}

export interface IngestionRecoveryResult {
  batchId: string;
  dryRun: boolean;
  previousStatus: IngestionBatchStatus;
  finalStatus: IngestionBatchStatus;
  actionTaken:
    | 'completed_pending_apply'
    | 'compensated_partial_writes'
    | 'marked_failed_no_writes'
    | 'no_action_needed';
  landedInsertedCount: number;
  landedUpdatedCount: number;
  deletedInsertedCount: number;
  restoredUpdatedCount: number;
  conflicts: IngestionRollbackConflict[];
  standaloneLimitationNote: string;
}

export interface ExternalSourceDuplicateGroup {
  externalSource: string;
  externalSourceId: string;
  count: number;
  docIds: string[];
  names: string[];
  sampleTruncated: boolean;
}

export interface IngestionIndexPreflightReport {
  collection: string;
  indexName: string;
  indexSpec: { externalSource: 1; externalSourceId: 1 };
  partialFilterExpression: {
    externalSource: { $type: 'string' };
    externalSourceId: { $type: 'string' };
  };
  scannedCount: number;
  duplicateGroupCount: number;
  displayedDuplicateGroupCount: number;
  totalAffectedDocuments: number;
  sampleLimits: {
    maxGroups: number;
    maxDocsPerGroup: number;
  };
  duplicates: ExternalSourceDuplicateGroup[];
  safeToCreateUniqueIndex: boolean;
  indexCreated: boolean;
  dryRun: boolean;
  remediationSteps: string[];
}

export interface LegacyNormalizedKeyBackfillResult {
  collection: string;
  dryRun: boolean;
  batchSize: number;
  batchesProcessed: number;
  scannedCount: number;
  missingKeyCount: number;
  computableCount: number;
  uncomputableCount: number;
  updatedCount: number;
  skippedConcurrentOrAlreadySetCount: number;
  sampleMissingDocIds: string[];
}

export class IngestionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestionValidationError';
  }
}
