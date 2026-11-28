import type { ObjectId } from 'mongodb';
import type { GeoJsonPoint } from '../utils/geo.utils';
import type { RatingScaleKind } from '../utils/restaurant-normalizer.util';

export const EXTERNAL_SOURCE_FOODY = 'foody_shopeefood' as const;
export const RAW_STAGING_COLLECTION = 'restaurants_raw_staging' as const;
export const INGESTION_BATCHES_COLLECTION = 'ingestion_batches' as const;
export const RESTAURANTS_COLLECTION = 'restaurants' as const;

export type IngestionMode = 'dry-run' | 'apply' | 'rollback';

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

export interface IngestionUpdatedBackup {
  docId: ObjectId;
  hadBatchIdBefore: boolean;
  previousFields: Record<string, unknown>;
}

export interface IngestionBatchLedgerDocument {
  _id: string;
  batchId: string;
  source: string;
  checksumSha256: string;
  status: 'applied' | 'rolled_back';
  targetDb: string;
  collection: string;
  appliedAt: Date;
  rolledBackAt: Date | null;
  metrics: IngestionQualityMetrics;
  insertedIds: ObjectId[];
  updatedBackups: IngestionUpdatedBackup[];
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

export interface IngestionRollbackResult {
  batchId: string;
  dryRun: boolean;
  status: 'dry_run_preview' | 'rolled_back' | 'already_rolled_back';
  deletedInsertedCount: number;
  restoredUpdatedCount: number;
  skippedUserOwnedOrModifiedCount: number;
}

export class IngestionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestionValidationError';
  }
}
