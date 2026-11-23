# GASTROWISE – API CLIENT COMPATIBILITY & ROUTING MATRIX

**Document:** `docs/migration/API_COMPATIBILITY_MATRIX.md`  
**Repository:** [KLTN-123-GastroWise-BE](https://github.com/maanxx/KLTN-123-GastroWise-BE)  
**Author:** Senior Software Architect & Backend Tech Lead  
**Last Updated:** November 20, 2026  
**Status:** 100% EXHAUSTIVE MATRIX — 70 BACKEND ENDPOINTS MAPPED TO 3 CLIENTS  

---

## 1. COMPATIBILITY PRINCIPLES FOR ZERO-BREAKAGE MIGRATION

To guarantee that Customer Web, Admin Web, and Mobile App continue operating without code refactoring or sudden downtime:
1. **API Gateway Facade:** Nginx API Gateway exposes the canonical base path `/api/v1/*` matching mobile expectations, while providing backward-compatible rewrite rules for clients calling root endpoints without `/api/v1`.
2. **Contract Preservation:** Request DTO bodies, path parameters, query string parameters, and response JSON schemas remain 100% identical.
3. **Dual Routing During Transition:** The Gateway proxies `/api/v1/itineraries/*` (and legacy `/itineraries/*`) to Planning Service (:3003) and all remaining paths to Core Service (:3001).

---

## 2. EXHAUSTIVE API ENDPOINT TO CLIENT & TARGET SERVICE MAPPING

### A. Authentication & Identity (`/auth/*`) — Target Service: Core Service (:3001)

| HTTP Method | Monolith Endpoint | Target Gateway Route | Consumed By | Auth Required | Compatibility & Migration Concerns |
| :--- | :--- | :--- | :---: | :---: | :--- |
| `GET` | `/auth/google` | `/api/v1/auth/google` | Web, Mobile | Public | None. Handled by Core Service. |
| `GET` | `/auth/google/callback`| `/api/v1/auth/google/callback` | Web, Mobile | Google OAuth | Gateway must forward query parameters and cookies. |
| `POST`| `/auth/register` | `/api/v1/auth/register` | FE, Mobile | Public | None. |
| `POST`| `/auth/login` | `/api/v1/auth/login` | FE, Admin, Mobile | Public | Returns `{ accessToken, refreshToken, user }`. |
| `POST`| `/auth/logout` | `/api/v1/auth/logout` | FE, Admin, Mobile | Bearer JWT | None. |
| `POST`| `/auth/refresh` | `/api/v1/auth/refresh` | FE, Admin, Mobile | Public / Refresh | Must forward refresh cookie or body token. |
| `GET` | `/auth/profile` | `/api/v1/auth/profile` | FE, Admin, Mobile | Bearer JWT | Note: FE has helper alias `/auth/me`; Gateway can alias `/auth/me` $\rightarrow$ `/auth/profile`. |
| `PATCH`| `/auth/profile` | `/api/v1/auth/profile` | FE, Mobile | Bearer JWT | None. |
| `POST`| `/auth/avatar` | `/api/v1/auth/avatar` | FE, Mobile | Bearer JWT | Multipart form-data upload; Gateway client_max_body_size set to 10MB. |
| `POST`| `/auth/forgot-password` | `/api/v1/auth/forgot-password` | FE, Mobile | Public | Sends email via Core Service. |
| `POST`| `/auth/reset-password` | `/api/v1/auth/reset-password` | FE, Mobile | Public | Validates reset token in Core DB. |
| `POST`| `/auth/2fa/generate` | `/api/v1/auth/2fa/generate` | Mobile | Bearer JWT | Returns QR code and secret. |
| `POST`| `/auth/2fa/enable` | `/api/v1/auth/2fa/enable` | Mobile | Bearer JWT | Validates TOTP token. |
| `POST`| `/auth/2fa/reset-password` | `/api/v1/auth/2fa/reset-password` | FE, Mobile | Public | 2FA verification step during recovery. |

---

### B. Restaurant & Menu Catalog (`/restaurants/*`) — Target Service: Core Service (:3001)

| HTTP Method | Monolith Endpoint | Target Gateway Route | Consumed By | Auth Required | Compatibility & Migration Concerns |
| :--- | :--- | :--- | :---: | :---: | :--- |
| `GET` | `/restaurants` | `/api/v1/restaurants` | FE, Admin, Mobile | Public | Supports filters, pagination, tags, search. |
| `GET` | `/restaurants/:id` | `/api/v1/restaurants/:id` | FE, Admin, Mobile | Public | Returns restaurant detail. |
| `POST`| `/restaurants` | `/api/v1/restaurants` | Admin | JWT + Admin | Admin venue creation. |
| `PATCH`| `/restaurants/:id` | `/api/v1/restaurants/:id` | Admin | JWT + Admin | Admin venue update. |
| `DELETE`| `/restaurants/:id` | `/api/v1/restaurants/:id` | Admin | JWT + Admin | Admin venue deletion. |
| `GET` | `/restaurants/nearby` | `/api/v1/restaurants/nearby` | Mobile | Public | Geospatial `$near` query on `location` (requires `2dsphere` index). |
| `GET` | `/restaurants/recommended` | `/api/v1/restaurants/recommended` | Mobile | Public | Calls AI Hybrid Recommender or DB fallback. |
| `GET` | `/restaurants/weather-recommend` | `/api/v1/restaurants/weather-recommend` | FE, Mobile | Public | Weather AI recommendation. |
| `POST`| `/restaurants/search-by-image` | `/api/v1/restaurants/search-by-image` | FE | Public | Multipart form-data; Core calls AI `/predict-food` on port 5000. |
| `POST`| `/restaurants/chat` | `/api/v1/restaurants/chat` | FE, Admin, Mobile | Public | Copilot NLP dialogue query; Core calls AI `/copilot/message`. |
| `POST`| `/restaurants/recommender/sync-cf`| `/api/v1/restaurants/recommender/sync-cf` | Admin | JWT + Admin | Admin manual SVD sync; Core calls AI `/cf/train`. |
| `GET` | `/restaurants/menu/all` | `/api/v1/restaurants/menu/all` | Admin | Public | Admin menu catalog review. |
| `GET` | `/restaurants/:id/menu` | `/api/v1/restaurants/:id/menu` | FE, Admin | Public | Venue menu list. |
| `POST`| `/restaurants/:id/menu` | `/api/v1/restaurants/:id/menu` | Admin | JWT + Admin | Add dish. |
| `PATCH`| `/restaurants/menu/:menuId` | `/api/v1/restaurants/menu/:menuId` | Admin | JWT + Admin | Update dish. |
| `DELETE`| `/restaurants/menu/:menuId` | `/api/v1/restaurants/menu/:menuId` | Admin | JWT + Admin | Delete dish. |

---

### C. Reviews & Sentiment (`/reviews/*`) — Target Service: Core Service (:3001)

| HTTP Method | Monolith Endpoint | Target Gateway Route | Consumed By | Current Auth | Target Auth & Security Enforcement [P0] |
| :--- | :--- | :--- | :---: | :---: | :--- |
| `GET` | `/reviews` | `/api/v1/reviews` | FE, Admin, Mobile | Public | Public read. |
| `GET` | `/reviews/stats` | `/api/v1/reviews/stats` | Admin | Public | Aggregate ratings and sentiment breakdown. |
| `GET` | `/reviews/all` | `/api/v1/reviews/all` | Admin | Public | Admin reviews moderation table. |
| `GET` | `/reviews/restaurant/:id` | `/api/v1/reviews/restaurant/:id` | FE | Public | Venue reviews. Note: FE also calls `/restaurants/${id}/reviews`; Gateway can proxy alias. |
| `POST`| `/reviews` | `/api/v1/reviews` | FE, Mobile | **MISSING** | **Enforce `JwtAuthGuard` [P0]**; extract `userId` from token. |
| `DELETE`| `/reviews/:id` | `/api/v1/reviews/:id` | Admin | **MISSING** | **Enforce `JwtAuthGuard` + Owner/Admin check [P0]**. |
| `PATCH`| `/reviews/:id` | `/api/v1/reviews/:id` | Admin | **MISSING** | **Enforce `JwtAuthGuard` + Owner/Admin check [P0]**. |
| `POST`| `/reviews/migrate-sentiment` | `/api/v1/reviews/migrate-sentiment` | Admin | **MISSING** | **Enforce `Roles('admin')` [P0]**. |

---

### D. Itinerary & Route Planning (`/itineraries/*`) — Target Service: Planning Service (:3003)

| HTTP Method | Monolith Endpoint | Target Gateway Route | Consumed By | Auth Required | Compatibility & Migration Concerns |
| :--- | :--- | :--- | :---: | :---: | :--- |
| `POST`| `/itineraries/generate` | `/api/v1/itineraries/generate` | FE, Mobile | Bearer JWT | **Critical Traffic Shift:** Gateway routes to Planning Service (:3003). |
| `GET` | `/itineraries` | `/api/v1/itineraries` | FE, Mobile | Bearer JWT | Returns current user's tour history. |
| `GET` | `/itineraries/all` | `/api/v1/itineraries/all` | Admin | JWT + Admin | Admin dashboard view of all tours. |
| `GET` | `/itineraries/:id` | `/api/v1/itineraries/:id` | FE, Admin, Mobile | Bearer JWT | Single tour detail with immutable stops snapshot. |
| `PATCH`| `/itineraries/:id/reorder` | `/api/v1/itineraries/:id/reorder` | Mobile | Bearer JWT | Drag-and-drop stop reordering; recalculates timetables. |
| `POST`| `/itineraries/:id/stops` | `/api/v1/itineraries/:id/stops` | Mobile | Bearer JWT | Add venue to existing tour; Planning calls Core `/internal/restaurants/:id`. |
| `DELETE`| `/itineraries/:id/stops/:stopId` | `/api/v1/itineraries/:id/stops/:stopId` | Mobile | Bearer JWT | Remove stop and recalculate metrics. |
| `POST`| `/itineraries/:id/recalculate` | `/api/v1/itineraries/:id/recalculate` | Mobile | Bearer JWT | Trigger recalculation with new budget or transit mode. |
| `PATCH`| `/itineraries/:id` | `/api/v1/itineraries/:id` | FE, Mobile | Bearer JWT | Update tour metadata (title, notes). |
| `DELETE`| `/itineraries/:id` | `/api/v1/itineraries/:id` | FE, Mobile | Bearer JWT | Delete tour. |

---

### E. User Preferences, Taste DNA & Favorites — Target Service: Core Service (:3001)

| HTTP Method | Monolith Endpoint | Target Gateway Route | Consumed By | Auth Required | Compatibility & Migration Concerns |
| :--- | :--- | :--- | :---: | :---: | :--- |
| `GET` | `/taste-dna/me` | `/api/v1/taste-dna/me` | Mobile | Bearer JWT | Returns 6-D vector Taste DNA. |
| `PATCH`| `/taste-dna/me` | `/api/v1/taste-dna/me` | Mobile | Bearer JWT | Manual calibration. |
| `POST`| `/taste-dna/quiz` | `/api/v1/taste-dna/quiz` | Mobile | Bearer JWT | Quiz submission and initial vector calculation. |
| `GET` | `/taste-dna/vector/:userId` | `/api/v1/taste-dna/vector/:userId` | Internal / Admin | Public | Exposes raw vector for AI / admin. |
| `GET` | `/favorites` | `/api/v1/favorites` | FE, Mobile | Bearer JWT | Returns user bookmarks. |
| `POST`| `/favorites/toggle` | `/api/v1/favorites/toggle` | FE, Mobile | Bearer JWT | Bookmarks toggle. |
| `GET` | `/favorites/top` | `/api/v1/favorites/top` | Admin | Public | Top 5 bookmarked venues KPI on Admin Dashboard. |

---

### F. Behavioral Telemetry & Contacts — Target Service: Core Service (:3001)

| HTTP Method | Monolith Endpoint | Target Gateway Route | Consumed By | Auth Required | Compatibility & Migration Concerns |
| :--- | :--- | :--- | :---: | :---: | :--- |
| `POST`| `/interactions` | `/api/v1/interactions` | FE | Public / JWT | Single event ingestion. |
| `POST`| `/interactions/batch` | `/api/v1/interactions/batch` | Mobile | Public / JWT | Analytics flush from mobile client. |
| `GET` | `/interactions/me` | `/api/v1/interactions/me` | User | Bearer JWT | User history view. |
| `GET` | `/interactions/popular` | `/api/v1/interactions/popular` | Public | Public | Top clicked/viewed targets. |
| `GET` | `/interactions/matrix` | `/api/v1/interactions/matrix` | Admin / Internal | **MISSING** | **Enforce `Roles('admin')` or `X-Internal-Service-Key` [P0]**. |
| `POST`| `/contacts` | `/api/v1/contacts` | FE | Public | User contact submission. |
| `GET` | `/contacts` | `/api/v1/contacts` | Admin | Public | Admin contact inbox. |
| `PATCH`| `/contacts/:id` | `/api/v1/contacts/:id` | Admin | Public | Status update. |
| `DELETE`| `/contacts/:id` | `/api/v1/contacts/:id` | Admin | Public | Contact deletion. |

---

### G. User Administration (`/users/*`) — Target Service: Core Service (:3001)

| HTTP Method | Monolith Endpoint | Target Gateway Route | Consumed By | Auth Required | Compatibility & Migration Concerns |
| :--- | :--- | :--- | :---: | :---: | :--- |
| `GET` | `/users` | `/api/v1/users` | Admin | JWT + Admin | Admin user listing. |
| `POST`| `/users` | `/api/v1/users` | Admin | JWT + Admin | Admin create user. |
| `GET` | `/users/:id` | `/api/v1/users/:id` | Admin, User | Bearer JWT | User detail. |
| `PATCH`| `/users/:id` | `/api/v1/users/:id` | Admin, User | Bearer JWT | User profile update. |
| `DELETE`| `/users/:id` | `/api/v1/users/:id` | Admin | JWT + Admin | Admin delete user. |

