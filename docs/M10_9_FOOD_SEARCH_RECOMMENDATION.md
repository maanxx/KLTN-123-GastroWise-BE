# M10.9 — Food Search & Recommendation Integration

- **Repository:** `maanxx/KLTN-123-GastroWise-BE`
- **Branch:** `feat/m10-9-food-search-recommendation` (branched from `origin/main` @ `293a42d`, which includes M10.8 PR #21)
- **Endpoint:** `GET /api/v1/recommendations/food` (also accessible via Nginx rewrite `GET /recommendations/food`)
- **OpenAPI Spec:** `docs/api/M10_5_RESTAURANT_DISH_OPENAPI.yaml`

---

## 1. Architecture Audit Summary

- **Core Service (`gastro_core` / local `gastro_core_test`):** Authoritative owner of `restaurants` and `menu_items`. Reuses `RestaurantsModule`, `RestaurantsService`, `mapRestaurantToDTO()`, `mapDishToDTO()`, `RESTAURANT_PUBLIC_PROJECTION`, and `DISH_PUBLIC_PROJECTION` — zero duplicate schemas or modules.
- **AI Service (`KLTN-123-GastroWise-AI`, FastAPI):** Existing `POST /recommend` accepts `RecommendRequest { query, candidate_ids, user_gps, dietary_exclusions }` authenticated via `X-Internal-AI-Key` (`INTERNAL_AI_KEY`). Core Service sends its authoritative candidate IDs with a `2000ms` timeout and validates every returned AI score strictly against Core's candidate ID set. AI can never fabricate IDs, names, dishes, prices, or addresses.
- **Nginx Gateway (`nginx/nginx.conf`):** Routes `/api/v1/recommendations/*` to `core-service:3001` via `location /api/v1/` and rewrites legacy `/recommendations/*` → `/api/v1/recommendations/*`.
- **Planning Service:** Remains strictly isolated from Core MongoDB; untouched.

---

## 2. API Contract (`GET /api/v1/recommendations/food`)

### Query Parameters (`QueryFoodRecommendationsDto`)
| Parameter | Type / Validation | Description |
|---|---|---|
| `keyword` | `string` (max 128) | Optional food/dish/restaurant search term |
| `latitude` | `number` (`-90..90`) | Must be paired with `longitude`; `[0, 0]` rejected with `400` |
| `longitude` | `number` (`-180..180`) | Must be paired with `latitude`; `[0, 0]` rejected with `400` |
| `radiusKm` | `number` (`0.1..100`, default `10`) | Maximum Haversine distance when coordinates are supplied |
| `minBudget` | `number` (`>= 0`) | Minimum VND budget (`minBudget > maxBudget` rejected with `400`) |
| `maxBudget` | `number` (`>= 0`) | Maximum VND budget |
| `cuisines` | `string` (max 256, comma-separated) | Preferred cuisines (matched against restaurant & dish tags/names) |
| `categories` | `string` (max 256, comma-separated) | Preferred categories/dishes |
| `isVegetarian` | `'true' \| 'false'` | When `'true'`, requires available vegetarian dishes |
| `limit` | `integer` (`1..50`, default `10`) | Maximum ranked recommendations returned |

### Ranking Weights & Truthfulness Rules (`food-recommendation.ranker.ts`)
- **Configurable Weights (`DEFAULT_FOOD_RECOMMENDATION_WEIGHTS`):**
  - `preferenceMatch`: `0.35`
  - `budgetSuitability`: `0.25`
  - `distanceProximity`: `0.20`
  - `availabilityQuality`: `0.10`
  - `ratingQuality`: `0.10`
  - `aiBlendWeight`: `0.25` (blends `0.75 * deterministic + 0.25 * aiSignal` only when AI returns verified scores for Core candidate IDs; otherwise falls back cleanly to `strategy: "deterministic"`).
- **Truthfulness & Determinism:**
  - Missing/unrated ratings receive `0` rating score and never emit `"Rated ..."`.
  - Missing coordinates never claim `"Nearby"` and do not satisfy an explicit radius filter.
  - Missing/zero prices never claim `"Within budget"` and do not satisfy an explicit budget filter.
  - Stable tie-breaker: `score DESC`, then `restaurant.id ASC`.
  - Zero N+1 queries: fetches candidate restaurants (`.limit(200)`) + single batched `menu_items` query (`restaurantId: { $in: candidateObjectIds }`).

### Response Format
```json
{
  "data": [
    {
      "restaurant": { "id": "...", "tenQuan": "Phở Hòa Pasteur", "rating": 4.5, "distance": 0.02 },
      "recommendedDishes": [
        { "id": "...", "name": "Phở Tái Nạm", "price": 75000, "isAvailable": true }
      ],
      "score": 0.9692,
      "reasons": [
        "Matches keyword \"Phở\"",
        "Within budget (<= 100,000 VND)",
        "Nearby (0.02 km away)",
        "Rated 4.5/5"
      ],
      "distanceKm": 0.02
    }
  ],
  "meta": {
    "total": 1,
    "limit": 10,
    "strategy": "deterministic",
    "weights": {
      "preferenceMatch": 0.35,
      "budgetSuitability": 0.25,
      "distanceProximity": 0.2,
      "availabilityQuality": 0.1,
      "ratingQuality": 0.1,
      "aiBlendWeight": 0.25
    }
  }
}
```

---

## 3. Sample `curl` Commands

```bash
# Keyword + location + radius + max budget
curl -sS "http://127.0.0.1:8080/api/v1/recommendations/food?keyword=Ph%E1%BB%9F&latitude=10.785&longitude=106.688&radiusKm=5&maxBudget=100000"

# Vegetarian dishes within budget
curl -sS "http://127.0.0.1:8080/api/v1/recommendations/food?isVegetarian=true&maxBudget=60000"

# Cuisine discovery
curl -sS "http://127.0.0.1:8080/api/v1/recommendations/food?cuisines=M%C3%B3n%20Vi%E1%BB%87t&limit=5"
```

---

## 4. Known Limitations

- When `gastro_core_test` receives new M10.7 restaurants after `gastrowise-ai-service` booted, AI Service's in-memory index does not contain those new IDs until restarted; Core Service safely detects 0 overlapping AI scores and falls back to `strategy: "deterministic"` without returning stale or fabricated entities.
- Restaurant-level budget fallback (only when a restaurant has 0 menu items) parses `giaCa` string; dish-level numeric `price` is always preferred whenever dishes exist.
