import type { ObjectId } from 'mongodb';
import type { GeoJsonPoint } from '../utils/geo.utils';
import type { RatingScaleKind } from '../utils/restaurant-normalizer.util';

export const EXTERNAL_SOURCE_FOODY = 'foody_shopeefood' as const;
export const RAW_STAGING_COLLECTION = 'restaurants_raw_staging' as const;
export const INGESTION_BATCHES_COLLECTION = 'ingestion_batches' as const;
export const RESTAURANTS_COLLECTION = 'restaurants' as const;
export const APPROVED_INGESTION_DB_NAME = 'gastro_core_test' as const;

export type IngestionMode = 'dry-run' | 'apply' | 'rollback' | 'recover';

export type IngestionBatchStatus =
  | 'pending'
  | 'applied'
  | 'failed'
  | 'rolled_back'
  | 'recovery_required';

export type ValidationSeverity = 'error' | 'warning';

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
  urlGoc: string;
  slug: string;
  contactPhone: string;
  status: 'open' | 'closed' | 'pending';
  ingestionBatchId: string;
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
}

export interface IngestionUpdatedBackup {
  docId: ObjectId;
  hadBatchIdBefore: boolean;
  previousFields: Record<string, unknown>;
  postIngestionDigest: string;
  expectedPostUpdatedAt: Date;
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

export class IngestionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestionValidationError';
  }
}
