# GastroWise — Frontend Web & Mobile Integration Guide (M10.10)

This contract documents the production-ready Core Service discovery, search, and recommendation APIs for **GastroWise Web (Next.js)** and **GastroWise Mobile (React Native / Expo)**.

- **OpenAPI 3.0.3 Specification:** `docs/api/M10_5_RESTAURANT_DISH_OPENAPI.yaml` (`v1.2.0`)
- **Base URL (Recommended via Nginx Gateway):** `http://localhost:8080/api/v1`
- **Base URL (Direct Core Service — local debug only):** `http://localhost:3001/api/v1`

---

## 1. Endpoints & Authentication Matrix

| Method | Endpoint | Auth Required | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/restaurants` | No (Public) | List, search, filter, and sort restaurants with pagination (`data` + `meta`) |
| `GET` | `/api/v1/restaurants/:id` | No (Public) | Get restaurant detail by 24-hex ObjectId or slug |
| `GET` | `/api/v1/restaurants/:id/dishes` | No (Public) | List paginated dishes strictly belonging to a restaurant |
| `GET` | `/api/v1/dishes` | No (Public) | Search, filter, and sort dishes across restaurants (`data` + `meta`) |
| `GET` | `/api/v1/dishes/:id` | No (Public) | Get single dish detail by 24-hex ObjectId |
| `GET` | `/api/v1/recommendations/food` | No (Public) | Personalized food discovery (hybrid AI + deterministic fallback) |

> **Note:** Mutating endpoints (`POST/PATCH/DELETE` on restaurants and menu items) require `Authorization: Bearer <JWT>` with `admin` or `owner` role. Public read endpoints never expose internal ingestion provenance (`ingestionBatchId`, `sourceMetadata`, `ownerId`) or internal AI credentials.

---

## 2. Query Parameters & Validation Rules

### A. `GET /api/v1/restaurants`
| Param | Type | Constraints / Default | Notes |
|---|---|---|---|
| `page` | integer | `1..1000` (default `1`) | Page number |
| `limit` | integer | `1..100` (default `32`) | Page size |
| `search` | string | max `128` chars | Hybrid AI + MongoDB regex search |
| `city`, `district`, `area` | string | max `64` chars | Location filters (`hcmc`, `hanoi`, district name) |
| `category`, `cuisine`, `tags` | string | max `128` chars | Category / cuisine tag matching |
| `minPrice`, `maxPrice` | number | `>= 0` (`minPrice <= maxPrice`) | Bounded VND price filter |
| `minRating` | number | `0..5` | Minimum normalized rating |
| `status` | enum | `open \| closed \| pending \| all` | Restaurant availability status |
| `sortBy` | enum | `diemTrungBinh \| rating \| price \| distance \| ...` | Sort key |
| `order` | enum | `asc \| desc` (default `desc`) | Sort direction |

### B. `GET /api/v1/dishes` & `GET /api/v1/restaurants/:id/dishes`
| Param | Type | Constraints / Default | Notes |
|---|---|---|---|
| `page` | integer | `1..1000` (default `1`) | Page number |
| `limit` | integer | `1..100` (default `20`) | Page size |
| `search` | string | max `128` chars | Matches dish `name`, `description`, `tags` |
| `restaurantId` | string | 24-hex ObjectId or `all` | Available on `/dishes` only |
| `minPrice`, `maxPrice` | number | `>= 0` (`minPrice <= maxPrice`) | Numeric VND price range |
| `category`, `tag` | string | max `64` chars | Composed with explicit `AND` semantics on `tags` |
| `isAvailable`, `isVegetarian` | enum | `"true" \| "false"` | Boolean string filters |
| `sortBy` | enum | `price \| isFeatured \| createdAt \| name` | Default `isFeatured` |
| `order` | enum | `asc \| desc` (default `desc`) | Sort direction |

### C. `GET /api/v1/recommendations/food`
| Param | Type | Constraints / Default | Notes |
|---|---|---|---|
| `keyword` | string | max `128` chars | Control chars stripped; whitespace-only treated as omitted |
| `latitude`, `longitude` | number | `lat [-90..90]`, `lon [-180..180]` | Must be paired together; `[0, 0]` rejected (`400`) |
| `radiusKm` | number | `0.1..100` (default `10`) | Applied when `latitude` + `longitude` are provided |
| `minBudget`, `maxBudget` | number | `0..50000000` (`minBudget <= maxBudget`) | VND budget range |
| `cuisines`, `categories` | string | max `256` chars (comma-separated) | User food/cuisine preferences |
| `isVegetarian` | enum | `"true" \| "false"` | Requires available vegetarian dishes when `"true"` |
| `limit` | integer | `1..50` (default `10`) | Maximum ranked recommendations returned |

---

## 3. Response Examples

### A. Paginated List (`GET /api/v1/restaurants` / `GET /api/v1/dishes`)
```json
{
  "data": [
    {
      "id": "6b0a8f383a3d2737c73a8633",
      "_id": "6b0a8f383a3d2737c73a8633",
      "restaurantId": "6b0a8f389e583fdd0ef73e27",
      "restaurant": {
        "id": "6b0a8f389e583fdd0ef73e27",
        "tenQuan": "Phở Hòa Pasteur",
        "diaChi": "260C Pasteur, Phường Võ Thị Sáu, Quận 3, TP. HCM",
        "lat": 10.7852,
        "lon": 106.6879,
        "location": { "type": "Point", "coordinates": [106.6879, 10.7852] }
      },
      "name": "Phở Tái Nạm",
      "price": 75000,
      "isVegetarian": false,
      "tags": ["Phở", "Bò", "Món chính"],
      "isAvailable": true,
      "isFeatured": true
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 6, "totalPages": 1 },
  "total": 6,
  "page": 1,
  "limit": 20,
  "totalPages": 1
}
```

### B. Food Recommendations (`GET /api/v1/recommendations/food`)
```json
{
  "data": [
    {
      "restaurant": {
        "id": "6b0a8f389e583fdd0ef73e27",
        "tenQuan": "Phở Hòa Pasteur",
        "rating": 4.5,
        "distance": 0.02,
        "status": "open"
      },
      "recommendedDishes": [
        { "id": "6b0a8f383a3d2737c73a8633", "name": "Phở Tái Nạm", "price": 75000, "isAvailable": true }
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

### C. Empty Result (`HTTP 200`)
```json
{
  "data": [],
  "meta": { "total": 0, "limit": 10, "strategy": "deterministic" }
}
```

### D. Validation & Not-Found Errors (`HTTP 400` / `HTTP 404`)
```json
// HTTP 400 Bad Request
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "minBudget cannot be greater than maxBudget."
}

// HTTP 404 Not Found
{
  "statusCode": 404,
  "error": "Not Found",
  "message": "Restaurant with ID or slug \"674000000000000000000099\" not found"
}
```

---

## 4. TypeScript Client Examples (Web & Mobile)

### Using `fetch` (React Native / Next.js)
```ts
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080/api/v1';

export async function fetchFoodRecommendations(params: {
  keyword?: string;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  minBudget?: number;
  maxBudget?: number;
  cuisines?: string[];
  categories?: string[];
  isVegetarian?: boolean;
  limit?: number;
}) {
  const qs = new URLSearchParams();
  if (params.keyword?.trim()) qs.set('keyword', params.keyword.trim());
  if (params.latitude !== undefined && params.longitude !== undefined) {
    qs.set('latitude', String(params.latitude));
    qs.set('longitude', String(params.longitude));
  }
  if (params.radiusKm !== undefined) qs.set('radiusKm', String(params.radiusKm));
  if (params.minBudget !== undefined) qs.set('minBudget', String(params.minBudget));
  if (params.maxBudget !== undefined) qs.set('maxBudget', String(params.maxBudget));
  if (params.cuisines?.length) qs.set('cuisines', params.cuisines.join(','));
  if (params.categories?.length) qs.set('categories', params.categories.join(','));
  if (params.isVegetarian !== undefined) qs.set('isVegetarian', String(params.isVegetarian));
  if (params.limit !== undefined) qs.set('limit', String(params.limit));

  const res = await fetch(`${API_BASE}/recommendations/food?${qs.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(Array.isArray(err.message) ? err.message.join('; ') : err.message);
  }
  return res.json();
}
```

### Using `axios` (Web / Admin)
```ts
import axios from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080/api/v1',
  timeout: 10_000,
});

export async function searchDishes(params: {
  search?: string;
  restaurantId?: string;
  minPrice?: number;
  maxPrice?: number;
  page?: number;
  limit?: number;
  sortBy?: 'price' | 'isFeatured' | 'createdAt' | 'name';
  order?: 'asc' | 'desc';
}) {
  const { data } = await api.get('/dishes', { params });
  return data; // { data: Dish[], meta: { page, limit, total, totalPages }, ... }
}
```

---

## 5. Safe Local Demo Scenarios (Local `gastro_core_test` Only)

> Never connect to MongoDB Atlas, never run remote migrations, and never execute `docker compose down -v`.

```bash
# Scenario A — Restaurant discovery
curl -sS "http://127.0.0.1:8080/api/v1/restaurants?page=1&limit=10"
curl -sS "http://127.0.0.1:8080/api/v1/restaurants?search=Ph%E1%BB%9F&page=1&limit=5"

# Scenario B — Dish discovery
curl -sS "http://127.0.0.1:8080/api/v1/dishes?minPrice=40000&maxPrice=80000&sortBy=price&order=asc"
curl -sS "http://127.0.0.1:8080/api/v1/restaurants/<restaurantId>/dishes?page=1&limit=10"

# Scenario C — Food recommendation (with budget, cuisine, location & deterministic fallback)
curl -sS "http://127.0.0.1:8080/api/v1/recommendations/food?keyword=Ph%E1%BB%9F&latitude=10.785&longitude=106.688&radiusKm=5&maxBudget=100000"
curl -sS "http://127.0.0.1:8080/api/v1/recommendations/food?isVegetarian=true&maxBudget=60000"
```
