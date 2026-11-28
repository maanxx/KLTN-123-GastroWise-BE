import {
  EXTERNAL_SOURCE_FOODY,
  IngestionValidationIssue,
  SUPPORTED_INGESTION_SOURCES,
} from './ingestion.types';
import {
  sanitizeDiagnosticValue,
  sanitizeRawPreview,
} from './ingestion.sanitizer';

export const MENU_ITEMS_COLLECTION = 'menu_items' as const;
export const MAX_REASONABLE_DISH_PRICE_VND = 50_000_000;

export interface RawDishSourceRecord {
  recordIndex: number;
  payload: Record<string, unknown>;
  parentRestaurantExternalId?: string;
  parentExternalSource?: string;
}

export interface NormalizedDishCandidate {
  recordIndex: number;
  externalSource: string;
  externalSourceId: string;
  restaurantExternalId?: string;
  restaurantObjectId?: string;
  name: string;
  description: string;
  price: number;
  image: string;
  isVegetarian: boolean;
  calories?: number;
  tags: string[];
  isAvailable: boolean;
  isFeatured: boolean;
  ingestionBatchId: string;
  sourceMetadata?: Record<string, unknown>;
}

export interface DishNormalizationOutcome {
  valid: boolean;
  candidate?: NormalizedDishCandidate;
  errors: IngestionValidationIssue[];
  warnings: IngestionValidationIssue[];
}

function normalizeCleanText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.normalize('NFC').replace(/\s+/g, ' ').trim();
}

function normalizeSourceId(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  return '';
}

function parseBooleanValue(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (lower === 'true' || lower === '1' || lower === 'yes') return true;
    if (lower === 'false' || lower === '0' || lower === 'no') return false;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return fallback;
}

/**
 * Parses numeric or formatted Vietnamese price inputs (e.g. 75000, "75.000đ", "65,000 VND", "55k", { value: 65000 })
 * into a finite non-negative numeric VND amount. Returns null if malformed or out of reasonable bounds.
 */
export function parseDishPriceVnd(raw: unknown): number | null {
  if (raw === null || raw === undefined) {
    return null;
  }

  let candidate: unknown = raw;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    candidate = obj.value ?? obj.amount ?? obj.price;
  }

  if (typeof candidate === 'number') {
    if (!Number.isFinite(candidate)) return null;
    if (candidate < 0 || candidate > MAX_REASONABLE_DISH_PRICE_VND) return null;
    return Math.round(candidate);
  }

  if (typeof candidate === 'string') {
    const cleaned = candidate.trim().toLowerCase();
    if (!cleaned) return null;

    // Handle shorthand like "55k" or "45.5k"
    const kMatch = /^(-?\d+(?:[.,]\d+)?)\s*k(?:\s*(?:đ|d|vnd))?$/i.exec(
      cleaned,
    );
    if (kMatch) {
      const base = Number(kMatch[1].replace(',', '.'));
      if (!Number.isFinite(base)) return null;
      const vnd = Math.round(base * 1000);
      if (vnd < 0 || vnd > MAX_REASONABLE_DISH_PRICE_VND) return null;
      return vnd;
    }

    // Strip currency symbols and whitespace
    const stripped = cleaned.replace(/(?:vnđ|vnd|đ|d|\s)/gi, '');
    if (!stripped) return null;

    // Detect negative sign explicitly
    if (stripped.startsWith('-')) return null;

    // Vietnamese thousand-separator format like "75.000" or "1.250.000" or "75,000"
    let normalizedNumeric: string;
    if (/^\d{1,3}(?:[.,]\d{3})+$/.test(stripped)) {
      normalizedNumeric = stripped.replace(/[.,]/g, '');
    } else if (/^\d+(?:\.\d+)?$/.test(stripped)) {
      normalizedNumeric = stripped;
    } else {
      return null;
    }

    const parsed = Number(normalizedNumeric);
    if (!Number.isFinite(parsed)) return null;
    const rounded = Math.round(parsed);
    if (rounded < 0 || rounded > MAX_REASONABLE_DISH_PRICE_VND) return null;
    return rounded;
  }

  return null;
}

/**
 * Validates and normalizes an optional image URL.
 * Rejects non-HTTP(S) schemes, malformed URLs, and URLs with embedded credentials.
 */
export function normalizeDishImageUrl(raw: unknown): {
  valid: boolean;
  url: string;
  reason?: string;
} {
  if (raw === null || raw === undefined) {
    return { valid: true, url: '' };
  }
  if (typeof raw !== 'string') {
    return { valid: false, url: '', reason: 'Image URL must be a string.' };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: true, url: '' };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        valid: false,
        url: '',
        reason: `Unsupported image URL protocol "${parsed.protocol}"; only http/https are allowed.`,
      };
    }
    if (parsed.username || parsed.password) {
      return {
        valid: false,
        url: '',
        reason: 'Image URL must not contain embedded credentials.',
      };
    }
    return { valid: true, url: parsed.toString() };
  } catch {
    return {
      valid: false,
      url: '',
      reason: 'Malformed image URL.',
    };
  }
}

function normalizeDishTags(payload: Record<string, unknown>): string[] {
  const rawList: string[] = [];
  const pushText = (val: unknown) => {
    if (typeof val === 'string') {
      for (const part of val.split(/[,;|]/)) {
        const cleaned = normalizeCleanText(part);
        if (cleaned) rawList.push(cleaned);
      }
    } else if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'string') {
          pushText(item);
        } else if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          pushText(obj.Name ?? obj.name ?? obj.label);
        }
      }
    }
  };

  pushText(payload.tags);
  pushText(payload.category);
  pushText(payload.CategoryName);
  pushText(payload.dishType);

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const tag of rawList) {
    const key = tag.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(tag);
    }
  }
  return deduped;
}

export function validateAndNormalizeDishRecord(
  record: RawDishSourceRecord,
  batchId: string,
  defaultSource: string = EXTERNAL_SOURCE_FOODY,
): DishNormalizationOutcome {
  const p = record.payload || {};
  const errors: IngestionValidationIssue[] = [];
  const warnings: IngestionValidationIssue[] = [];

  const externalSource =
    normalizeCleanText(
      p.externalSource ?? p.source ?? record.parentExternalSource,
    ) || defaultSource;

  const externalSourceId = normalizeSourceId(
    p.externalSourceId ?? p.dishId ?? p.DishID ?? p.id ?? p.ID,
  );

  const restaurantExternalId = normalizeSourceId(
    p.restaurantExternalId ??
      p.RestaurantID ??
      p.restaurantSourceId ??
      record.parentRestaurantExternalId,
  );

  const restaurantObjectIdRaw = normalizeCleanText(p.restaurantId);
  const restaurantObjectId = /^[0-9a-fA-F]{24}$/.test(restaurantObjectIdRaw)
    ? restaurantObjectIdRaw
    : undefined;

  if (
    !(SUPPORTED_INGESTION_SOURCES as readonly string[]).includes(externalSource)
  ) {
    errors.push({
      recordIndex: record.recordIndex,
      field: 'externalSource',
      errorCode: 'DISH_UNSUPPORTED_SOURCE',
      reason: `Unsupported ingestion source "${externalSource}".`,
      severity: 'error',
      sourceId: externalSourceId || undefined,
      originalValue: sanitizeDiagnosticValue(externalSource),
    });
  }

  if (!externalSourceId) {
    errors.push({
      recordIndex: record.recordIndex,
      field: 'externalSourceId',
      errorCode: 'DISH_MISSING_SOURCE_ID',
      reason: 'Dish record requires a stable externalSourceId (or dishId/id).',
      severity: 'error',
    });
  }

  if (!restaurantExternalId && !restaurantObjectId) {
    errors.push({
      recordIndex: record.recordIndex,
      field: 'restaurantExternalId',
      errorCode: 'DISH_MISSING_RESTAURANT_REF',
      reason:
        'Dish record requires restaurantExternalId (or RestaurantID / 24-hex restaurantId) to link to a restaurant.',
      severity: 'error',
      sourceId: externalSourceId || undefined,
    });
  }

  const name = normalizeCleanText(p.name ?? p.Name ?? p.dishName);
  if (!name) {
    errors.push({
      recordIndex: record.recordIndex,
      field: 'name',
      errorCode: 'DISH_MISSING_NAME',
      reason: 'Dish name is required.',
      severity: 'error',
      sourceId: externalSourceId || undefined,
    });
  }

  const rawPrice = p.price ?? p.Price ?? p.discountPrice ?? p.originalPrice;
  const price = parseDishPriceVnd(rawPrice);
  if (price === null) {
    errors.push({
      recordIndex: record.recordIndex,
      field: 'price',
      errorCode: 'DISH_INVALID_PRICE',
      reason:
        rawPrice === undefined || rawPrice === null || rawPrice === ''
          ? 'Dish price is required.'
          : `Dish price must be a non-negative VND amount <= ${MAX_REASONABLE_DISH_PRICE_VND}.`,
      severity: 'error',
      sourceId: externalSourceId || undefined,
      originalValue: sanitizeDiagnosticValue(rawPrice),
    });
  }

  const rawImage =
    p.image ??
    p.imageUrl ??
    p.ImageUrl ??
    (Array.isArray(p.photos) && p.photos.length > 0
      ? (p.photos[0] as Record<string, unknown>)?.value
      : undefined);
  const imageCheck = normalizeDishImageUrl(rawImage);
  if (!imageCheck.valid) {
    errors.push({
      recordIndex: record.recordIndex,
      field: 'image',
      errorCode: 'DISH_INVALID_IMAGE_URL',
      reason: imageCheck.reason || 'Invalid dish image URL.',
      severity: 'error',
      sourceId: externalSourceId || undefined,
      originalValue: sanitizeDiagnosticValue(rawImage),
    });
  }

  let calories: number | undefined;
  if (p.calories !== undefined && p.calories !== null && p.calories !== '') {
    const calNum = Number(p.calories);
    if (!Number.isFinite(calNum) || calNum < 0) {
      errors.push({
        recordIndex: record.recordIndex,
        field: 'calories',
        errorCode: 'DISH_INVALID_CALORIES',
        reason: 'Dish calories must be a non-negative number.',
        severity: 'error',
        sourceId: externalSourceId || undefined,
        originalValue: sanitizeDiagnosticValue(p.calories),
      });
    } else {
      calories = Math.round(calNum);
    }
  }

  const description = normalizeCleanText(p.description ?? p.Description);
  const tags = normalizeDishTags(p);
  if (tags.length === 0) {
    warnings.push({
      recordIndex: record.recordIndex,
      field: 'tags',
      errorCode: 'DISH_MISSING_TAGS',
      reason: 'Dish record has no category or tags.',
      severity: 'warning',
      sourceId: externalSourceId || undefined,
    });
  }

  if (errors.length > 0 || price === null) {
    return { valid: false, errors, warnings };
  }

  const isVegetarian = parseBooleanValue(p.isVegetarian, false);
  const isAvailable = parseBooleanValue(p.isAvailable ?? p.is_available, true);
  const isFeatured = parseBooleanValue(p.isFeatured ?? p.is_featured, false);

  let sanitizedMetadata: Record<string, unknown> | undefined;
  if (
    p.sourceMetadata &&
    typeof p.sourceMetadata === 'object' &&
    !Array.isArray(p.sourceMetadata)
  ) {
    const cleaned = sanitizeRawPreview(
      p.sourceMetadata as Record<string, unknown>,
    );
    if (Object.keys(cleaned).length > 0) {
      sanitizedMetadata = cleaned;
    }
  }

  return {
    valid: true,
    candidate: {
      recordIndex: record.recordIndex,
      externalSource,
      externalSourceId,
      restaurantExternalId: restaurantExternalId || undefined,
      restaurantObjectId,
      name,
      description,
      price,
      image: imageCheck.url,
      isVegetarian,
      ...(calories !== undefined ? { calories } : {}),
      tags,
      isAvailable,
      isFeatured,
      ingestionBatchId: batchId,
      ...(sanitizedMetadata ? { sourceMetadata: sanitizedMetadata } : {}),
    },
    errors: [],
    warnings,
  };
}

/**
 * Extracts raw restaurant and dish records from a unified food dataset JSON payload.
 * Supports:
 * - `{ restaurants: [...], dishes?: [...] }`
 * - `[ ...restaurants ]` (each optionally containing nested `dishes`, `menu`, or `menuItems`)
 */
export function extractFoodDatasetRecords(rawContent: string): {
  restaurants: Record<string, unknown>[];
  dishes: RawDishSourceRecord[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch (err) {
    throw new Error(
      `Invalid JSON food dataset: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let restaurants: Record<string, unknown>[] = [];
  const dishes: RawDishSourceRecord[] = [];

  if (Array.isArray(parsed)) {
    restaurants = parsed.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object' && !Array.isArray(item),
    );
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.restaurants)) {
      restaurants = obj.restaurants.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      );
    }
    if (Array.isArray(obj.dishes)) {
      obj.dishes.forEach((item) => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          dishes.push({
            recordIndex: dishes.length,
            payload: item as Record<string, unknown>,
          });
        }
      });
    }
  } else {
    throw new Error(
      'Food dataset JSON must be an array of restaurants or an object with `restaurants` and optional `dishes` arrays.',
    );
  }

  // Also collect nested dishes/menu/menuItems inside restaurant records
  for (const rest of restaurants) {
    const parentRestId = normalizeSourceId(
      rest.externalSourceId ?? rest.RestaurantID ?? rest.id,
    );
    const parentSource = normalizeCleanText(rest.externalSource ?? rest.source);
    const nested = rest.dishes ?? rest.menu ?? rest.menuItems;
    if (Array.isArray(nested)) {
      for (const dish of nested) {
        if (dish && typeof dish === 'object' && !Array.isArray(dish)) {
          dishes.push({
            recordIndex: dishes.length,
            payload: dish as Record<string, unknown>,
            parentRestaurantExternalId: parentRestId || undefined,
            parentExternalSource: parentSource || undefined,
          });
        }
      }
    }
  }

  return { restaurants, dishes };
}
