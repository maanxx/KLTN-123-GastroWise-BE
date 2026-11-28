export type RatingScaleKind = '10_point' | '5_point' | 'ambiguous' | 'default';

export interface NormalizedRatingResult {
  rating: number;
  rawRating: number;
  ratingScale: RatingScaleKind;
  isAmbiguous: boolean;
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
): '10_point' | '5_point' | 'ambiguous' | null {
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
  if (normalized === 'ambiguous' || normalized === 'unknown') {
    return 'ambiguous';
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
 *
 * Assumptions & Limitations for [0, 5] inputs without explicit scale metadata:
 * - If Foody subscores exist (diemChatLuong, diemViTri, etc.) and reviewsCount === 0,
 *   the value is classified as `10_point` and divided by 2.
 * - If reviewsCount > 0 (user review recalculation), the value is classified as `5_point`.
 * - Otherwise, when explicit scale metadata is absent and value is in [0, 5], scale
 *   cannot be verified (`10_point` vs `5_point`). We pass the bounded value through
 *   for display compatibility, but explicitly mark `ratingScale: 'ambiguous'` and
 *   `isAmbiguous: true` instead of silently claiming `5_point`.
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
      isAmbiguous: false,
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
        isAmbiguous: false,
      };
    }
    const scale = explicitScale ?? '5_point';
    return {
      rating: clampFiveStar(val),
      rawRating: recordedRaw ?? val,
      ratingScale: scale,
      isAmbiguous: scale === 'ambiguous',
    };
  }

  const rawValue =
    toFiniteNumber(doc.diemTrungBinh) ?? toFiniteNumber(doc.rating);
  if (rawValue === null) {
    return {
      rating: defaultRating,
      rawRating: defaultRating,
      ratingScale: 'default',
      isAmbiguous: false,
    };
  }

  if (rawValue < 0) {
    const scale = explicitScale ?? 'default';
    return {
      rating: 0,
      rawRating: rawValue,
      ratingScale: scale,
      isAmbiguous: scale === 'ambiguous',
    };
  }

  if (rawValue > 10) {
    const scale = explicitScale ?? '10_point';
    return {
      rating: 5.0,
      rawRating: rawValue,
      ratingScale: scale,
      isAmbiguous: scale === 'ambiguous',
    };
  }

  // If rawRating was already preserved on a candidate DTO without _ratingNormalized, preserve scale without dividing again.
  if (recordedRaw !== null && toFiniteNumber(doc.rating) !== null) {
    const scale = explicitScale ?? '5_point';
    return {
      rating: clampFiveStar(toFiniteNumber(doc.rating) as number),
      rawRating: recordedRaw,
      ratingScale: scale,
      isAmbiguous: scale === 'ambiguous',
    };
  }

  if (explicitScale === '10_point') {
    return {
      rating: clampFiveStar(rawValue / 2),
      rawRating: rawValue,
      ratingScale: '10_point',
      isAmbiguous: false,
    };
  }

  if (explicitScale === '5_point') {
    return {
      rating: clampFiveStar(rawValue),
      rawRating: rawValue,
      ratingScale: '5_point',
      isAmbiguous: false,
    };
  }

  if (rawValue > 5) {
    return {
      rating: clampFiveStar(rawValue / 2),
      rawRating: rawValue,
      ratingScale: '10_point',
      isAmbiguous: false,
    };
  }

  if (explicitScale === 'ambiguous') {
    return {
      rating: clampFiveStar(rawValue),
      rawRating: rawValue,
      ratingScale: 'ambiguous',
      isAmbiguous: true,
    };
  }

  const hasFoodySubscores = FOODY_SUBSCORE_KEYS.some(
    (key) => toFiniteNumber(doc[key]) !== null,
  );
  const reviewsCountNum = toFiniteNumber(doc.reviewsCount);
  const reviewsCount = Math.max(0, reviewsCountNum ?? 0);

  if (hasFoodySubscores && reviewsCount === 0) {
    return {
      rating: clampFiveStar(rawValue / 2),
      rawRating: rawValue,
      ratingScale: '10_point',
      isAmbiguous: false,
    };
  }

  if (reviewsCountNum !== null && reviewsCount > 0) {
    return {
      rating: clampFiveStar(rawValue),
      rawRating: rawValue,
      ratingScale: '5_point',
      isAmbiguous: false,
    };
  }

  return {
    rating: clampFiveStar(rawValue),
    rawRating: rawValue,
    ratingScale: 'ambiguous',
    isAmbiguous: true,
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
 * Canonicalize stop order_index values deterministically to unique contiguous
 * 1-based numbering [1..N] without silent duplicates, skipped positions, or
 * double +1 offset across 0-based, 1-based, missing, duplicate, and mixed inputs.
 */
export function normalizeStopOrderIndexes<T extends OrderableStop>(
  stops: readonly T[],
): Array<T & { order_index: number }> {
  if (!Array.isArray(stops) || stops.length === 0) {
    return [];
  }

  const typedStops: readonly OrderableStop[] = stops;
  const ranked: Array<{ idx: number; rank: number }> = [];
  for (let idx = 0; idx < typedStops.length; idx++) {
    const raw = typedStops[idx]?.order_index;
    const hasValidIndex =
      typeof raw === 'number' && Number.isFinite(raw) && raw >= 0;
    ranked.push({
      idx,
      rank: hasValidIndex ? raw : Number.POSITIVE_INFINITY,
    });
  }

  ranked.sort((a, b) => {
    if (a.rank !== b.rank) {
      return a.rank - b.rank;
    }
    return a.idx - b.idx;
  });

  return ranked.map(
    ({ idx }, pos) =>
      Object.assign({} as Record<string, unknown>, stops[idx], {
        order_index: pos + 1,
      }) as T & { order_index: number },
  );
}
