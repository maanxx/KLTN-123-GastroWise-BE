import { toGeoJsonPoint } from '../utils/geo.utils';
import {
  normalizeRestaurantRating,
  normalizeRestaurantTags,
  RatingScaleKind,
} from '../utils/restaurant-normalizer.util';
import {
  EXTERNAL_SOURCE_FOODY,
  IngestionValidationIssue,
  NormalizedRestaurantCandidate,
  ParsedRawRecord,
} from './ingestion.types';

export interface RecordNormalizationOutcome {
  candidate: NormalizedRestaurantCandidate | null;
  errors: IngestionValidationIssue[];
  warnings: IngestionValidationIssue[];
  invalidOrMissingCoords: boolean;
  ratingKind: '10_point' | '5_point' | 'unrated_zero' | 'ambiguous';
  missingTags: boolean;
  missingPrice: boolean;
  missingAddress: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readText(
  doc: Record<string, unknown>,
  keys: readonly string[],
): string {
  for (const key of keys) {
    const val = doc[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
    if (typeof val === 'number' && Number.isFinite(val)) {
      return String(val);
    }
  }
  return '';
}

function readOptionalFiniteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || typeof value === 'boolean') {
    return undefined;
  }
  if (typeof value === 'string' && value.trim().length === 0) {
    return undefined;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function formatVndAmount(amount: number): string {
  const rounded = Math.round(amount);
  return `${rounded.toLocaleString('en-US').replace(/,/g, '.')}đ`;
}

function extractFoodySubscores(doc: Record<string, unknown>): {
  diemKhongGian?: number;
  diemViTri?: number;
  diemChatLuong?: number;
  diemPhucVu?: number;
  diemGiaCa?: number;
} {
  const result: {
    diemKhongGian?: number;
    diemViTri?: number;
    diemChatLuong?: number;
    diemPhucVu?: number;
    diemGiaCa?: number;
  } = {};

  const assignIfValid = (
    key: keyof typeof result,
    candidate: unknown,
  ): void => {
    const num = readOptionalFiniteNumber(candidate);
    if (num !== undefined && num >= 0 && num <= 10) {
      result[key] = num;
    }
  };

  assignIfValid('diemKhongGian', doc.diemKhongGian);
  assignIfValid('diemViTri', doc.diemViTri);
  assignIfValid('diemChatLuong', doc.diemChatLuong);
  assignIfValid('diemPhucVu', doc.diemPhucVu);
  assignIfValid('diemGiaCa', doc.diemGiaCa);

  const avgPointList = doc.AvgPointList;
  if (Array.isArray(avgPointList)) {
    for (const entry of avgPointList) {
      const obj = asRecord(entry);
      if (!obj) {
        continue;
      }
      const label =
        typeof obj.Label === 'string' ? obj.Label.toLowerCase() : '';
      const point = readOptionalFiniteNumber(obj.Point);
      if (point === undefined || point < 0 || point > 10) {
        continue;
      }
      if (label.includes('không gian')) result.diemKhongGian ??= point;
      else if (label.includes('vị trí')) result.diemViTri ??= point;
      else if (label.includes('chất lượng')) result.diemChatLuong ??= point;
      else if (label.includes('phục vụ')) result.diemPhucVu ??= point;
      else if (label.includes('giá')) result.diemGiaCa ??= point;
    }
  }

  return result;
}

function extractOpeningHours(doc: Record<string, unknown>): string {
  const explicitStr = readText(doc, ['gioMoCua', 'openingTime', 'openTime']);
  if (explicitStr.length > 0) {
    return explicitStr;
  }

  const openingList = doc.OpeningTime;
  if (!Array.isArray(openingList) || openingList.length === 0) {
    return '';
  }

  const first = asRecord(openingList[0]);
  if (!first) {
    return '';
  }

  const timeOpen = asRecord(first.TimeOpen);
  const timeClose = asRecord(first.TimeClose);
  if (!timeOpen || !timeClose) {
    return '';
  }

  const openH = readOptionalFiniteNumber(timeOpen.Hours);
  const openM = readOptionalFiniteNumber(timeOpen.Minutes) ?? 0;
  const closeH = readOptionalFiniteNumber(timeClose.Hours);
  const closeM = readOptionalFiniteNumber(timeClose.Minutes) ?? 0;

  if (
    openH === undefined ||
    closeH === undefined ||
    openH < 0 ||
    openH > 23 ||
    closeH < 0 ||
    closeH > 23
  ) {
    return '';
  }

  const pad = (n: number): string => String(Math.floor(n)).padStart(2, '0');
  return `${pad(openH)}:${pad(openM)} - ${pad(closeH)}:${pad(closeM)}`;
}

function extractPriceRange(doc: Record<string, unknown>): string {
  const pMin =
    readOptionalFiniteNumber(doc.PriceMin) ??
    readOptionalFiniteNumber(doc.giaMin);
  const pMax =
    readOptionalFiniteNumber(doc.PriceMax) ??
    readOptionalFiniteNumber(doc.giaMax);

  const validMin = pMin !== undefined && pMin > 0 ? pMin : undefined;
  const validMax = pMax !== undefined && pMax > 0 ? pMax : undefined;

  if (validMin !== undefined && validMax !== undefined) {
    if (validMin === validMax) {
      return formatVndAmount(validMin);
    }
    const low = Math.min(validMin, validMax);
    const high = Math.max(validMin, validMax);
    return `${formatVndAmount(low)} - ${formatVndAmount(high)}`;
  }
  if (validMin !== undefined) {
    return formatVndAmount(validMin);
  }
  if (validMax !== undefined) {
    return formatVndAmount(validMax);
  }

  const rawText = readText(doc, ['giaCa', 'priceRange', 'price']);
  if (rawText.length === 0 || /^0+(\.0+)?\s*đ?$/i.test(rawText)) {
    return '';
  }
  return rawText;
}

function extractDeduplicatedTags(doc: Record<string, unknown>): string {
  const collected: string[] = [];

  const pushNormalized = (value: unknown): void => {
    for (const token of normalizeRestaurantTags(value)) {
      collected.push(token);
    }
  };

  pushNormalized(doc.tags);
  pushNormalized(doc.cuisines);
  pushNormalized(doc.MetaKeywords);

  if (Array.isArray(doc.Cuisines)) {
    for (const entry of doc.Cuisines) {
      const obj = asRecord(entry);
      if (obj) {
        pushNormalized(obj.Name);
      } else {
        pushNormalized(entry);
      }
    }
  }

  if (Array.isArray(doc.LstCategory)) {
    for (const entry of doc.LstCategory) {
      const obj = asRecord(entry);
      if (obj) {
        pushNormalized(obj.Name);
      }
    }
  }

  const uniqueByLower = new Map<string, string>();
  for (const tag of collected) {
    const cleaned = tag.replace(/\s+/g, ' ').trim();
    if (!cleaned) {
      continue;
    }
    const key = cleaned.toLowerCase();
    if (!uniqueByLower.has(key)) {
      uniqueByLower.set(key, cleaned);
    }
  }

  return Array.from(uniqueByLower.values()).join(', ');
}

function validateHttpUrl(rawUrl: string): string {
  if (!rawUrl) {
    return '';
  }
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch {
    return '';
  }
  return '';
}

function extractSourceUrlAndSlug(doc: Record<string, unknown>): {
  urlGoc: string;
  slug: string;
} {
  const rawMicrosite = readText(doc, [
    'MicrositeUrl',
    'urlGoc',
    'RestaurantUrl',
  ]);
  const rawSlug = readText(doc, ['ResUrlRewrite', 'slug']);

  let urlGoc = '';
  if (
    rawMicrosite.startsWith('http://') ||
    rawMicrosite.startsWith('https://')
  ) {
    urlGoc = validateHttpUrl(rawMicrosite);
  } else if (rawMicrosite.startsWith('/')) {
    urlGoc = `https://www.foody.vn${rawMicrosite}`;
  } else if (rawMicrosite.length > 0 && rawMicrosite.includes('/')) {
    urlGoc = `https://www.foody.vn/${rawMicrosite}`;
  } else if (rawSlug.length > 0) {
    urlGoc = `https://www.foody.vn/ho-chi-minh/${rawSlug}`;
  }

  let slug = rawSlug;
  if (!slug && rawMicrosite.length > 0) {
    const segments = rawMicrosite.split('/').filter(Boolean);
    if (segments.length > 0) {
      slug = segments[segments.length - 1];
    }
  }
  slug = slug.trim().toLowerCase();

  return { urlGoc, slug };
}

function deriveCityId(doc: Record<string, unknown>): string | undefined {
  const explicitCityId = readText(doc, ['cityId']);
  if (explicitCityId) {
    return explicitCityId;
  }
  const numericCityId = readOptionalFiniteNumber(doc.CityID);
  if (numericCityId === 217) {
    return 'hcmc';
  }
  if (numericCityId === 218) {
    return 'hanoi';
  }

  const cityName = readText(doc, [
    'City',
    'thanhPho',
    'Location',
    'diaChi',
    'Address',
  ]);
  if (
    /hồ chí minh|ho chi minh|tp\.?\s?hcm|tphcm|sài gòn|ho-chi-minh/i.test(
      cityName,
    )
  ) {
    return 'hcmc';
  }
  if (/hà nội|ha noi|hanoi|ha-noi/i.test(cityName)) {
    return 'hanoi';
  }
  return undefined;
}

function readExplicitRatingScaleInput(
  doc: Record<string, unknown>,
): '10_point' | '5_point' | 'ambiguous' | null {
  const raw = doc.ratingScale ?? doc.raw_rating_scale ?? doc.rating_scale;
  if (typeof raw !== 'string') {
    return null;
  }
  const normalized = raw.trim().toLowerCase();
  if (
    normalized === '10_point' ||
    normalized === '10' ||
    normalized === 'scale_10'
  ) {
    return '10_point';
  }
  if (
    normalized === '5_point' ||
    normalized === '5' ||
    normalized === 'scale_5'
  ) {
    return '5_point';
  }
  if (normalized === 'ambiguous' || normalized === 'unknown') {
    return 'ambiguous';
  }
  return null;
}

/**
 * Validates and normalizes one raw scraped record into a schema-safe candidate without
 * ever fabricating missing GPS coordinates, prices, ratings, or opening hours.
 */
export function validateAndNormalizeRestaurantRecord(
  parsed: ParsedRawRecord,
  batchId: string,
): RecordNormalizationOutcome {
  const { recordIndex, payload } = parsed;
  const errors: IngestionValidationIssue[] = [];
  const warnings: IngestionValidationIssue[] = [];

  if (
    payload._malformedJsonLine !== undefined ||
    payload._invalidPayload !== undefined
  ) {
    errors.push({
      recordIndex,
      field: 'record',
      errorCode: 'MALFORMED_RECORD',
      reason:
        typeof payload._parseError === 'string'
          ? `Malformed JSON record: ${payload._parseError}`
          : 'Record must be a valid JSON object.',
      severity: 'error',
    });
    return {
      candidate: null,
      errors,
      warnings,
      invalidOrMissingCoords: false,
      ratingKind: 'unrated_zero',
      missingTags: false,
      missingPrice: false,
      missingAddress: false,
    };
  }

  const externalSourceId = readText(payload, [
    'RestaurantID',
    'restaurantId',
    'externalSourceId',
  ]);
  const externalSource =
    readText(payload, ['externalSource', 'source']) || EXTERNAL_SOURCE_FOODY;
  const tenQuan = readText(payload, ['Name', 'tenQuan', 'name']);

  if (!externalSourceId) {
    errors.push({
      recordIndex,
      field: 'RestaurantID',
      errorCode: 'MISSING_EXTERNAL_ID',
      reason: 'Missing required RestaurantID / externalSourceId identifier.',
      severity: 'error',
    });
  }

  if (!tenQuan) {
    errors.push({
      recordIndex,
      field: 'Name',
      errorCode: 'MISSING_NAME',
      reason: 'Missing required restaurant Name / tenQuan.',
      severity: 'error',
      sourceId: externalSourceId || undefined,
    });
  }

  if (payload.IsDelete === true) {
    errors.push({
      recordIndex,
      field: 'IsDelete',
      errorCode: 'DELETED_UPSTREAM_RECORD',
      reason: 'Upstream record has IsDelete=true and cannot be imported.',
      severity: 'error',
      sourceId: externalSourceId || undefined,
    });
  }

  if (errors.length > 0) {
    return {
      candidate: null,
      errors,
      warnings,
      invalidOrMissingCoords: false,
      ratingKind: 'unrated_zero',
      missingTags: false,
      missingPrice: false,
      missingAddress: false,
    };
  }

  // Address (do not fabricate default city string when absent)
  const diaChi = readText(payload, ['Address', 'diaChi', 'address']);
  const missingAddress = diaChi.length === 0;
  if (missingAddress) {
    warnings.push({
      recordIndex,
      field: 'Address',
      errorCode: 'MISSING_ADDRESS',
      reason: 'Address is missing; leaving diaChi empty without fabrication.',
      severity: 'warning',
      sourceId: externalSourceId,
    });
  }

  // Coordinates (accept upstream typo Longtitude as well as lon/lng; reject [0,0] / invalid)
  const rawLat = payload.Latitude ?? payload.lat;
  const rawLon = payload.Longtitude ?? payload.lon ?? payload.lng;
  const geoPoint = toGeoJsonPoint(rawLat, rawLon);
  const invalidOrMissingCoords = geoPoint === null;
  if (invalidOrMissingCoords) {
    warnings.push({
      recordIndex,
      field: 'Latitude/Longtitude',
      errorCode: 'INVALID_OR_MISSING_COORDINATES',
      reason:
        'Coordinates are missing, out of WGS84 bounds, or [0, 0]; storing location=null without fabrication.',
      severity: 'warning',
      sourceId: externalSourceId,
    });
  }

  // Subscores & Ratings (separate Foody TotalReview into foodyReviewsCount;
  // do NOT treat native reviewsCount as Foody count without explicit provenance)
  const subscores = extractFoodySubscores(payload);
  const hasExplicitFoodyReviewsProvenance =
    payload._reviewsCountIsFoodySource === true ||
    payload.crawlerSource === 'crawl_shopeefood';
  const foodyReviewsCount = readOptionalFiniteNumber(
    payload.TotalReview ??
      payload.foodyReviewsCount ??
      (hasExplicitFoodyReviewsProvenance ? payload.reviewsCount : undefined),
  );
  const rawRatingInput = readOptionalFiniteNumber(
    payload.AvgRating ?? payload.diemTrungBinh ?? payload.rating,
  );
  const explicitScale = readExplicitRatingScaleInput(payload);

  let diemTrungBinh: number | undefined;
  let rawRating: number | undefined;
  let ratingScale: RatingScaleKind = 'default';
  let ratingNormalizedFlag = false;
  let ratingKind: RecordNormalizationOutcome['ratingKind'] = 'unrated_zero';

  if (rawRatingInput === undefined) {
    ratingKind = 'unrated_zero';
    ratingScale = 'default';
    warnings.push({
      recordIndex,
      field: 'AvgRating',
      errorCode: 'MISSING_RATING',
      reason:
        'AvgRating / diemTrungBinh is missing; leaving rating unset without fabrication.',
      severity: 'warning',
      sourceId: externalSourceId,
    });
  } else if (rawRatingInput === 0) {
    rawRating = 0;
    diemTrungBinh = 0;
    ratingScale =
      explicitScale ??
      (externalSource === EXTERNAL_SOURCE_FOODY ? '10_point' : 'ambiguous');
    ratingNormalizedFlag = ratingScale !== 'ambiguous';
    ratingKind = 'unrated_zero';
  } else {
    let resolvedInputScale: '10_point' | '5_point' | 'ambiguous' | undefined =
      explicitScale ?? undefined;
    if (!resolvedInputScale) {
      if (
        externalSource === EXTERNAL_SOURCE_FOODY ||
        rawRatingInput > 5 ||
        Object.keys(subscores).length > 0
      ) {
        resolvedInputScale = '10_point';
      } else {
        resolvedInputScale = 'ambiguous';
      }
    }

    const norm = normalizeRestaurantRating({
      diemTrungBinh: rawRatingInput,
      ratingScale: resolvedInputScale,
      ...subscores,
      reviewsCount: 0,
    });

    diemTrungBinh = norm.rating;
    rawRating = norm.rawRating;
    ratingScale = norm.ratingScale;
    ratingNormalizedFlag = !norm.isAmbiguous;

    if (norm.ratingScale === '10_point') {
      ratingKind = '10_point';
    } else if (norm.ratingScale === '5_point') {
      ratingKind = '5_point';
    } else {
      ratingKind = 'ambiguous';
      warnings.push({
        recordIndex,
        field: 'AvgRating',
        errorCode: 'AMBIGUOUS_RATING_SCALE',
        reason: `Rating ${rawRatingInput} in [0, 5] lacks explicit scale metadata; flagged as ratingScale='ambiguous'.`,
        severity: 'warning',
        sourceId: externalSourceId,
      });
    }
  }

  // Price (never fabricate 50.000đ when 0 or missing)
  const giaCa = extractPriceRange(payload);
  const missingPrice = giaCa.length === 0;
  if (missingPrice) {
    warnings.push({
      recordIndex,
      field: 'PriceMin/PriceMax',
      errorCode: 'MISSING_OR_ZERO_PRICE',
      reason:
        'Price range is missing or 0; storing empty giaCa without fabrication.',
      severity: 'warning',
      sourceId: externalSourceId,
    });
  }

  // Opening hours (never fabricate 08:00 - 22:00 when absent)
  const gioMoCua = extractOpeningHours(payload);

  // Tags (deterministic deduplicated comma-separated tags)
  const tags = extractDeduplicatedTags(payload);
  const missingTags = tags.length === 0;
  if (missingTags) {
    warnings.push({
      recordIndex,
      field: 'tags',
      errorCode: 'MISSING_TAGS',
      reason: 'No cuisines, categories, or keywords found; storing empty tags.',
      severity: 'warning',
      sourceId: externalSourceId,
    });
  }

  // Avatar URL
  const pictureModel = asRecord(payload.PictureModel);
  const rawAvatar =
    (pictureModel
      ? readText(pictureModel, ['ImageUrl', 'FullSizeImageUrl'])
      : '') || readText(payload, ['MobileImageUrl', 'avatarUrl']);
  const avatarUrl = validateHttpUrl(rawAvatar);

  // Source URL & slug
  const { urlGoc, slug } = extractSourceUrlAndSlug(payload);

  // Status (respect IsActive=false as 'closed')
  const status: 'open' | 'closed' =
    payload.IsActive === false ? 'closed' : 'open';

  const candidate: NormalizedRestaurantCandidate = {
    recordIndex,
    externalSource,
    externalSourceId,
    tenQuan,
    diaChi,
    cityId: deriveCityId(payload),
    lat: geoPoint ? geoPoint.coordinates[1] : undefined,
    lon: geoPoint ? geoPoint.coordinates[0] : undefined,
    location: geoPoint,
    coordsValid: !invalidOrMissingCoords,
    diemTrungBinh,
    rawRating,
    ratingScale,
    _ratingNormalized: ratingNormalizedFlag,
    ...subscores,
    foodyReviewsCount:
      foodyReviewsCount !== undefined
        ? Math.max(0, Math.round(foodyReviewsCount))
        : undefined,
    giaCa,
    gioMoCua,
    tags,
    avatarUrl,
    urlGoc,
    slug,
    contactPhone: readText(payload, ['contactPhone', 'Phone', 'Mobile']),
    status,
    ingestionBatchId: batchId,
  };

  return {
    candidate,
    errors,
    warnings,
    invalidOrMissingCoords,
    ratingKind,
    missingTags,
    missingPrice,
    missingAddress,
  };
}
