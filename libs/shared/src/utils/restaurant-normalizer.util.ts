export type RatingScaleKind = '10_point' | '5_point' | 'default';

export interface NormalizedRatingResult {
  rating: number;
  rawRating: number;
  ratingScale: RatingScaleKind;
}

export const DEFAULT_NEUTRAL_RATING = 3.0;

const FOODY_SUBSCORE_KEYS = [
  'diemChatLuong',
  'diemViTri',
  'diemPhucVu',
  'diemGiaCa',
  'diemKhongGian',
] as const;

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function roundOneDecimal(value: number): number {
  return Number(value.toFixed(1));
}

function clampFiveStar(value: number): number {
  return roundOneDecimal(Math.max(0, Math.min(5, value)));
}

function resolveExplicitRatingScale(
  rawScale: unknown,
): '10_point' | '5_point' | null {
  if (typeof rawScale !== 'string') {
    return null;
  }
  const normalized = rawScale.trim().toLowerCase();
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
  return null;
}

/**
 * Normalize MongoDB restaurant tags stored as string ("a, b"), array (["a", "b"]),
 * or null/undefined into a clean string[] without unsafe .split() calls.
 */
export function normalizeRestaurantTags(rawTags: unknown): string[] {
  if (rawTags === null || rawTags === undefined) {
    return [];
  }

  const parts: string[] = [];
  if (Array.isArray(rawTags)) {
    for (const entry of rawTags) {
      if (typeof entry === 'string') {
        for (const piece of entry.split(',')) {
          const trimmed = piece.trim();
          if (trimmed) {
            parts.push(trimmed);
          }
        }
      }
    }
    return parts;
  }

  if (typeof rawTags === 'string') {
    for (const piece of rawTags.split(',')) {
      const trimmed = piece.trim();
      if (trimmed) {
        parts.push(trimmed);
      }
    }
    return parts;
  }

  return [];
}

/**
 * Format restaurant tags into a comma-separated string for DTO compatibility.
 */
export function formatRestaurantTagsString(rawTags: unknown): string {
  return normalizeRestaurantTags(rawTags).join(', ');
}

/**
 * Normalize heterogeneous restaurant ratings (Foody 10-point vs GastroWise 5-point)
 * into a bounded [0.0, 5.0] rating while preventing double normalization.
 */
export function normalizeRestaurantRating(
  doc: Record<string, unknown> | null | undefined,
  options: { defaultRating?: number } = {},
): NormalizedRatingResult {
  const defaultRating = options.defaultRating ?? DEFAULT_NEUTRAL_RATING;
  if (!doc || typeof doc !== 'object') {
    return {
      rating: defaultRating,
      rawRating: defaultRating,
      ratingScale: 'default',
    };
  }

  const alreadyNormalized =
    doc._ratingNormalized === true || doc._rating_normalized === true;
  const recordedRaw =
    toFiniteNumber(doc.rawRating) ?? toFiniteNumber(doc.raw_rating);
  const explicitScale = resolveExplicitRatingScale(
    doc.ratingScale ?? doc.raw_rating_scale ?? doc.rating_scale,
  );

  // When a document is already marked normalized, clamp to [0, 5] without dividing again.
  if (alreadyNormalized) {
    const val =
      toFiniteNumber(doc.rating) ??
      toFiniteNumber(doc.diemTrungBinh) ??
      recordedRaw;
    if (val === null) {
      return {
        rating: defaultRating,
        rawRating: defaultRating,
        ratingScale: 'default',
      };
    }
    return {
      rating: clampFiveStar(val),
      rawRating: recordedRaw ?? val,
      ratingScale: explicitScale ?? '5_point',
    };
  }

  const rawValue =
    toFiniteNumber(doc.diemTrungBinh) ?? toFiniteNumber(doc.rating);
  if (rawValue === null) {
    return {
      rating: defaultRating,
      rawRating: defaultRating,
      ratingScale: 'default',
    };
  }

  if (rawValue < 0) {
    return {
      rating: 0,
      rawRating: rawValue,
      ratingScale: explicitScale ?? '5_point',
    };
  }

  if (rawValue > 10) {
    return {
      rating: 5.0,
      rawRating: rawValue,
      ratingScale: explicitScale ?? '10_point',
    };
  }

  // If rawRating was already preserved on a candidate DTO without _ratingNormalized, treat rating as 5-pt.
  if (recordedRaw !== null && toFiniteNumber(doc.rating) !== null) {
    return {
      rating: clampFiveStar(toFiniteNumber(doc.rating) as number),
      rawRating: recordedRaw,
      ratingScale: explicitScale ?? '5_point',
    };
  }

  if (explicitScale === '10_point') {
    return {
      rating: clampFiveStar(rawValue / 2),
      rawRating: rawValue,
      ratingScale: '10_point',
    };
  }

  if (explicitScale === '5_point') {
    return {
      rating: clampFiveStar(rawValue),
      rawRating: rawValue,
      ratingScale: '5_point',
    };
  }

  if (rawValue > 5) {
    return {
      rating: clampFiveStar(rawValue / 2),
      rawRating: rawValue,
      ratingScale: '10_point',
    };
  }

  const hasFoodySubscores = FOODY_SUBSCORE_KEYS.some(
    (key) => toFiniteNumber(doc[key]) !== null,
  );
  const reviewsCount = Math.max(0, toFiniteNumber(doc.reviewsCount) ?? 0);

  if (hasFoodySubscores && reviewsCount === 0) {
    return {
      rating: clampFiveStar(rawValue / 2),
      rawRating: rawValue,
      ratingScale: '10_point',
    };
  }

  return {
    rating: clampFiveStar(rawValue),
    rawRating: rawValue,
    ratingScale: '5_point',
  };
}

/**
 * Parse price numbers or Vietnamese price range strings (e.g. "65.000đ", "30.000đ - 150.000đ")
 * into a single positive VND estimate, or return fallback when missing/invalid.
 */
export function parseRestaurantPriceVnd(
  rawPrice: unknown,
  fallback = 50000,
): number {
  if (typeof rawPrice === 'number') {
    return Number.isFinite(rawPrice) && rawPrice > 0
      ? Math.round(rawPrice)
      : fallback;
  }

  if (typeof rawPrice !== 'string' || rawPrice.trim().length === 0) {
    return fallback;
  }

  const trimmed = rawPrice.trim();
  if (trimmed.startsWith('-')) {
    return fallback;
  }

  const segments = trimmed
    .split(/[-–~]/)
    .map((part) => part.replace(/[^\d]/g, ''))
    .filter((digits) => digits.length > 0)
    .map((digits) => Number.parseInt(digits, 10))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (segments.length === 0) {
    return fallback;
  }

  const avg = segments.reduce((sum, val) => sum + val, 0) / segments.length;
  return Math.round(avg);
}

export interface OrderableStop {
  order_index?: number;
}

/**
 * Canonicalize stop order_index values to 1-based numbering [1..N] once,
 * preventing double +1 offset between AI solver responses and Planning service.
 */
export function normalizeStopOrderIndexes<T extends OrderableStop>(
  stops: readonly T[],
): Array<T & { order_index: number }> {
  if (!Array.isArray(stops) || stops.length === 0) {
    return [];
  }

  const typedStops: readonly OrderableStop[] = stops;
  let hasZeroBasedIndex = false;
  for (let i = 0; i < typedStops.length; i++) {
    const val = typedStops[i].order_index;
    if (typeof val === 'number' && val === 0) {
      hasZeroBasedIndex = true;
      break;
    }
  }

  const result: Array<T & { order_index: number }> = [];
  for (let idx = 0; idx < stops.length; idx++) {
    const raw = typedStops[idx].order_index;
    let normalized: number;
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
      normalized = hasZeroBasedIndex ? raw + 1 : raw === 0 ? 1 : raw;
    } else {
      normalized = idx + 1;
    }
    const copy = Object.assign({} as Record<string, unknown>, stops[idx], {
      order_index: normalized,
    }) as T & { order_index: number };
    result.push(copy);
  }
  return result;
}
