import { extractValidGeoPoint } from '@shared/utils/geo.utils';
import {
  normalizeRestaurantRating,
  normalizeRestaurantTags,
  parseRestaurantPriceVnd,
} from '@shared/utils/restaurant-normalizer.util';

export interface FoodRecommendationWeights {
  preferenceMatch: number;
  budgetSuitability: number;
  distanceProximity: number;
  availabilityQuality: number;
  ratingQuality: number;
  aiBlendWeight: number;
}

export const DEFAULT_FOOD_RECOMMENDATION_WEIGHTS: FoodRecommendationWeights = {
  preferenceMatch: 0.35,
  budgetSuitability: 0.25,
  distanceProximity: 0.2,
  availabilityQuality: 0.1,
  ratingQuality: 0.1,
  aiBlendWeight: 0.25,
};

export interface FoodRecommendationContext {
  keyword?: string;
  userPoint?: { lat: number; lon: number } | null;
  radiusKm: number;
  minBudget?: number;
  maxBudget?: number;
  preferences: string[]; // normalized lowercase cuisines + categories
  isVegetarianOnly: boolean;
  aiScoresByRestaurantId?: Map<string, number>;
  weights?: FoodRecommendationWeights;
}

export interface RankedFoodRecommendationItem {
  restaurant: Record<string, unknown>;
  recommendedDishes: Array<Record<string, unknown>>;
  score: number;
  reasons: string[];
  distanceKm?: number;
}

function asSafeString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const toRad = (deg: number) => deg * (Math.PI / 180);
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function parseCommaList(raw?: string): string[] {
  if (!raw || typeof raw !== 'string') return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const cleaned = part.trim();
    const key = cleaned.toLowerCase();
    if (cleaned && !seen.has(key)) {
      seen.add(key);
      out.push(cleaned);
    }
  }
  return out;
}

export function extractPreferenceTerms(
  cuisines?: string,
  categories?: string,
): string[] {
  const combined = [...parseCommaList(cuisines), ...parseCommaList(categories)];
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const item of combined) {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(item);
    }
  }
  return deduped;
}

/**
 * Validates raw AI relevance scores strictly against Core's authoritative candidate ID set.
 * Never allows AI to introduce fabricated restaurant IDs or out-of-range scores.
 */
export function extractValidatedAiScores(
  rawPayload: unknown,
  authoritativeCandidateIds: Set<string>,
): Map<string, number> {
  const scores = new Map<string, number>();
  if (!rawPayload || typeof rawPayload !== 'object') {
    return scores;
  }

  const obj = rawPayload as Record<string, unknown>;
  const entries = Array.isArray(obj.scores)
    ? obj.scores
    : Array.isArray(obj.items)
      ? obj.items
      : [];

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const id = typeof rec.id === 'string' ? rec.id.trim() : '';
    if (!id || !authoritativeCandidateIds.has(id)) {
      continue;
    }

    const rawScore =
      typeof rec.score === 'number'
        ? rec.score
        : typeof rec.S_taste === 'number'
          ? rec.S_taste
          : null;
    if (rawScore === null || !Number.isFinite(rawScore) || rawScore < 0) {
      continue;
    }

    // Clamp to [0, 1] (supports both 0..1 and 0..100 normalized outputs safely)
    const normalized = rawScore > 1 ? Math.min(1, rawScore / 100) : rawScore;
    scores.set(id, normalized);
  }

  return scores;
}

function scoreDishForContext(
  dish: Record<string, unknown>,
  ctx: FoodRecommendationContext,
): {
  matchesHardConstraints: boolean;
  dishScore: number;
  matchedTerms: string[];
  matchesKeyword: boolean;
  withinBudget: boolean;
} {
  const price =
    typeof dish.price === 'number' && Number.isFinite(dish.price)
      ? dish.price
      : null;
  const isAvailable = dish.isAvailable !== false;
  const isVegetarian = Boolean(dish.isVegetarian);

  if (!isAvailable) {
    return {
      matchesHardConstraints: false,
      dishScore: 0,
      matchedTerms: [],
      matchesKeyword: false,
      withinBudget: false,
    };
  }
  if (ctx.isVegetarianOnly && !isVegetarian) {
    return {
      matchesHardConstraints: false,
      dishScore: 0,
      matchedTerms: [],
      matchesKeyword: false,
      withinBudget: false,
    };
  }

  const hasBudgetFilter =
    ctx.minBudget !== undefined || ctx.maxBudget !== undefined;
  let withinBudget = false;
  if (hasBudgetFilter) {
    // Unknown/missing price must NOT be treated as within budget
    if (price === null || price <= 0) {
      return {
        matchesHardConstraints: false,
        dishScore: 0,
        matchedTerms: [],
        matchesKeyword: false,
        withinBudget: false,
      };
    }
    if (ctx.minBudget !== undefined && price < ctx.minBudget) {
      return {
        matchesHardConstraints: false,
        dishScore: 0,
        matchedTerms: [],
        matchesKeyword: false,
        withinBudget: false,
      };
    }
    if (ctx.maxBudget !== undefined && price > ctx.maxBudget) {
      return {
        matchesHardConstraints: false,
        dishScore: 0,
        matchedTerms: [],
        matchesKeyword: false,
        withinBudget: false,
      };
    }
    withinBudget = true;
  }

  const nameText = typeof dish.name === 'string' ? dish.name.toLowerCase() : '';
  const descText =
    typeof dish.description === 'string' ? dish.description.toLowerCase() : '';
  const tagsList = Array.isArray(dish.tags)
    ? dish.tags.map((t) => String(t).toLowerCase())
    : [];
  const haystack = `${nameText} ${descText} ${tagsList.join(' ')}`;

  const matchedTerms: string[] = [];
  for (const term of ctx.preferences) {
    if (haystack.includes(term.toLowerCase())) {
      matchedTerms.push(term);
    }
  }

  const keywordLower = ctx.keyword?.trim().toLowerCase() || '';
  const matchesKeyword = Boolean(
    keywordLower && haystack.includes(keywordLower),
  );

  let dishScore = 0.2;
  if (matchedTerms.length > 0) dishScore += 0.4;
  if (matchesKeyword) dishScore += 0.3;
  if (dish.isFeatured) dishScore += 0.1;

  return {
    matchesHardConstraints: true,
    dishScore,
    matchedTerms,
    matchesKeyword,
    withinBudget,
  };
}

/**
 * Deterministic + optional Hybrid restaurant & dish ranking engine.
 * Guarantees truthful reasons, safe handling of missing data, and stable ID tie-breaking.
 */
export function rankFoodRecommendations(
  candidates: Array<{
    rawRestaurant: Record<string, unknown>;
    restaurantDto: Record<string, unknown>;
    dishDtos: Array<Record<string, unknown>>;
  }>,
  ctx: FoodRecommendationContext,
): RankedFoodRecommendationItem[] {
  const weights = ctx.weights ?? DEFAULT_FOOD_RECOMMENDATION_WEIGHTS;
  const keywordLower = ctx.keyword?.trim().toLowerCase() || '';
  const hasBudgetFilter =
    ctx.minBudget !== undefined || ctx.maxBudget !== undefined;

  const ranked: RankedFoodRecommendationItem[] = [];

  for (const item of candidates) {
    const { rawRestaurant, restaurantDto, dishDtos } = item;
    const restId =
      asSafeString(restaurantDto.id) || asSafeString(restaurantDto._id);
    if (!restId) continue;

    // 1. Restaurant availability filter (exclude closed/pending restaurants)
    const status =
      typeof rawRestaurant.status === 'string' ? rawRestaurant.status : 'open';
    if (status !== 'open') {
      continue;
    }

    // 2. Geographic distance check (strict: never claim nearby when coordinates are missing)
    let distanceKm: number | undefined;
    let distanceScore = 0;
    if (ctx.userPoint) {
      const restGeo = extractValidGeoPoint(rawRestaurant);
      if (restGeo) {
        distanceKm = Number(
          haversineDistanceKm(
            ctx.userPoint.lat,
            ctx.userPoint.lon,
            restGeo.lat,
            restGeo.lon,
          ).toFixed(2),
        );
        if (distanceKm > ctx.radiusKm) {
          continue;
        }
        distanceScore = Math.max(0, 1 - distanceKm / ctx.radiusKm);
      } else {
        // Missing coordinates cannot satisfy an explicit radius filter
        continue;
      }
    }

    // 3. Evaluate available dishes belonging to this restaurant
    const evaluatedDishes: Array<{
      dto: Record<string, unknown>;
      dishScore: number;
      matchedTerms: string[];
      matchesKeyword: boolean;
      withinBudget: boolean;
    }> = [];

    for (const dishDto of dishDtos) {
      const ev = scoreDishForContext(dishDto, ctx);
      if (ev.matchesHardConstraints) {
        evaluatedDishes.push({ dto: dishDto, ...ev });
      }
    }

    // If vegetarian-only filter requested, require at least one available vegetarian dish
    if (ctx.isVegetarianOnly && evaluatedDishes.length === 0) {
      continue;
    }

    // 4. Budget evaluation (prefer concrete dish prices; fall back to restaurant parsed giaCa only if > 0)
    const restParsedPrice = parseRestaurantPriceVnd(
      (rawRestaurant.giaCa as string | undefined) ||
        (rawRestaurant.priceRange as string | undefined),
    );
    const hasReliableRestPrice =
      typeof restParsedPrice === 'number' &&
      Number.isFinite(restParsedPrice) &&
      restParsedPrice > 0;

    let budgetScore = 0;
    let budgetConfirmed = false;
    if (hasBudgetFilter) {
      if (evaluatedDishes.some((d) => d.withinBudget)) {
        budgetConfirmed = true;
        budgetScore = 1;
      } else if (
        dishDtos.length === 0 &&
        hasReliableRestPrice &&
        (ctx.minBudget === undefined || restParsedPrice >= ctx.minBudget) &&
        (ctx.maxBudget === undefined || restParsedPrice <= ctx.maxBudget)
      ) {
        budgetConfirmed = true;
        budgetScore = 0.8;
      } else {
        // Fails explicit budget constraint (missing/unknown price does not pass!)
        continue;
      }
    } else if (evaluatedDishes.length > 0 || hasReliableRestPrice) {
      budgetScore = 0.5;
    }

    // 5. Cuisine / category / keyword preference matching
    const restTags = normalizeRestaurantTags(rawRestaurant.tags);
    const restName = (
      asSafeString(rawRestaurant.tenQuan) || asSafeString(rawRestaurant.name)
    ).toLowerCase();
    const restAddress = (
      asSafeString(rawRestaurant.diaChi) || asSafeString(rawRestaurant.address)
    ).toLowerCase();
    const restHaystack = `${restName} ${restAddress} ${restTags.join(' ').toLowerCase()}`;

    const matchedPrefSet = new Set<string>();
    for (const pref of ctx.preferences) {
      if (restHaystack.includes(pref.toLowerCase())) {
        matchedPrefSet.add(pref);
      }
    }
    for (const d of evaluatedDishes) {
      for (const t of d.matchedTerms) {
        matchedPrefSet.add(t);
      }
    }

    const keywordMatchedInRest = Boolean(
      keywordLower && restHaystack.includes(keywordLower),
    );
    const keywordMatchedInDish = evaluatedDishes.some((d) => d.matchesKeyword);
    const keywordMatched = keywordMatchedInRest || keywordMatchedInDish;

    // Require preference or keyword match when user explicitly requested them
    if (ctx.preferences.length > 0 && matchedPrefSet.size === 0) {
      continue;
    }
    if (keywordLower && !keywordMatched) {
      continue;
    }

    let preferenceScore = 0;
    if (ctx.preferences.length > 0) {
      preferenceScore = matchedPrefSet.size / ctx.preferences.length;
    } else if (keywordLower && keywordMatched) {
      preferenceScore = 1;
    } else {
      preferenceScore = 0.5;
    }
    if (keywordLower && keywordMatched && ctx.preferences.length > 0) {
      preferenceScore = Math.min(1, preferenceScore * 0.7 + 0.3);
    }

    // 6. Availability score
    const availabilityScore =
      evaluatedDishes.length > 0
        ? Math.min(1, 0.5 + evaluatedDishes.length * 0.15)
        : 0.4;

    // 7. Rating quality (missing/unrated/ambiguous gets 0, NEVER a perfect or fabricated score)
    const explicitRawRating =
      typeof rawRestaurant.diemTrungBinh === 'number' &&
      Number.isFinite(rawRestaurant.diemTrungBinh)
        ? rawRestaurant.diemTrungBinh
        : typeof rawRestaurant.rating === 'number' &&
            Number.isFinite(rawRestaurant.rating)
          ? rawRestaurant.rating
          : 0;
    const ratingInfo = normalizeRestaurantRating(rawRestaurant);
    const hasReliableRating =
      explicitRawRating > 0 &&
      !ratingInfo.isAmbiguous &&
      typeof ratingInfo.rating === 'number' &&
      ratingInfo.rating > 0;
    const ratingScore = hasReliableRating
      ? Math.min(1, ratingInfo.rating / 5)
      : 0;

    // 8. Deterministic composite score + optional validated AI blend
    const deterministicScore =
      weights.preferenceMatch * preferenceScore +
      weights.budgetSuitability * budgetScore +
      weights.distanceProximity * distanceScore +
      weights.availabilityQuality * availabilityScore +
      weights.ratingQuality * ratingScore;

    const aiSignal = ctx.aiScoresByRestaurantId?.get(restId);
    const finalScore =
      aiSignal !== undefined
        ? (1 - weights.aiBlendWeight) * deterministicScore +
          weights.aiBlendWeight * aiSignal
        : deterministicScore;

    // 9. Truthful, evidence-only reasons
    const reasons: string[] = [];
    if (matchedPrefSet.size > 0) {
      reasons.push(
        `Matches preferences: ${Array.from(matchedPrefSet).join(', ')}`,
      );
    }
    if (keywordLower && keywordMatched) {
      reasons.push(`Matches keyword "${ctx.keyword?.trim()}"`);
    }
    if (budgetConfirmed) {
      if (ctx.minBudget !== undefined && ctx.maxBudget !== undefined) {
        reasons.push(
          `Within budget (${ctx.minBudget.toLocaleString('en-US')}–${ctx.maxBudget.toLocaleString('en-US')} VND)`,
        );
      } else if (ctx.maxBudget !== undefined) {
        reasons.push(
          `Within budget (<= ${ctx.maxBudget.toLocaleString('en-US')} VND)`,
        );
      } else if (ctx.minBudget !== undefined) {
        reasons.push(
          `Meets minimum budget (>= ${ctx.minBudget.toLocaleString('en-US')} VND)`,
        );
      }
    }
    if (distanceKm !== undefined) {
      reasons.push(`Nearby (${distanceKm} km away)`);
    }
    if (ctx.isVegetarianOnly && evaluatedDishes.length > 0) {
      reasons.push(
        `Vegetarian dishes available (${evaluatedDishes.length} item${evaluatedDishes.length > 1 ? 's' : ''})`,
      );
    }
    if (hasReliableRating) {
      reasons.push(`Rated ${ratingInfo.rating.toFixed(1)}/5`);
    }
    if (aiSignal !== undefined) {
      reasons.push('Enhanced with AI relevance signal');
    }
    if (reasons.length === 0) {
      reasons.push('Open restaurant available for discovery');
    }

    // Sort recommended dishes deterministically (score desc, price asc, id asc)
    evaluatedDishes.sort((a, b) => {
      if (b.dishScore !== a.dishScore) return b.dishScore - a.dishScore;
      const pA = typeof a.dto.price === 'number' ? a.dto.price : 0;
      const pB = typeof b.dto.price === 'number' ? b.dto.price : 0;
      if (pA !== pB) return pA - pB;
      return asSafeString(a.dto.id).localeCompare(asSafeString(b.dto.id));
    });

    const enrichedRestaurant =
      distanceKm !== undefined
        ? { ...restaurantDto, distance: distanceKm }
        : restaurantDto;

    ranked.push({
      restaurant: enrichedRestaurant,
      recommendedDishes: evaluatedDishes.slice(0, 5).map((d) => d.dto),
      score: Number(finalScore.toFixed(4)),
      reasons,
      ...(distanceKm !== undefined ? { distanceKm } : {}),
    });
  }

  // Stable descending score sort with deterministic restaurant ID tie-breaker
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return asSafeString(a.restaurant.id).localeCompare(
      asSafeString(b.restaurant.id),
    );
  });

  return ranked;
}
