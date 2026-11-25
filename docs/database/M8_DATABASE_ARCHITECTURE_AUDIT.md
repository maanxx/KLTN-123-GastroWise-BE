# M8 — GastroWise MongoDB Architecture & Schema Audit

- **Repository Audited:** `maanxx/KLTN-123-GastroWise-BE` (branch `feature/m8-1-database-architecture-audit` from `origin/fix/m2.3-backend-integration-security` `9ecda75`)
- **Companion Services Inspected (Read-Only):** `KLTN-123-GastroWise-AI`
- **Audit Mode:** Static read-only code & configuration inspection (no live MongoDB Atlas cluster modified; zero schema changes made).

---

## 1. Current Database Ownership & Connection Topology

GastroWise implements the **Database-per-Service** pattern across logical MongoDB databases, configured in NestJS `AppModule`s and Python `app/config.py`:

| Service | ORM / Driver | URI Env Var (Fallback) | DB Name Env Var (Default) | Docker Test DB (`docker-compose.yml`) | Access Pattern |
|---|---|---|---|---|---|
| **Core Service** (`:3001`) | Mongoose (`@nestjs/mongoose`) | `MONGODB_URI_CORE` (`MONGODB_URI`) | `CORE_DB_NAME` (`gastro_core`) | `gastro_core_test` (`mongo-test:27017`) | Read / Write |
| **Planning Service** (`:3003`) | Mongoose (`@nestjs/mongoose`) | `MONGODB_URI_PLANNING` (`MONGODB_URI`) | `PLANNING_DB_NAME` (`gastro_planning`) | `gastro_planning_test` (`mongo-test:27017`) | Read / Write |
| **AI Service** (`:5000`) | PyMongo (`pymongo.MongoClient`) | `MONGODB_URI` | `MONGODB_DB_NAME` (`gastrowise`) | `gastro_ai_test` (`mongo-test:27017`) | **Read-Only** (`restaurants`) |

> [!WARNING]
> **DB Name Alignment Risk (AI vs. Core):** Core Service writes restaurants to `CORE_DB_NAME` (`gastro_core` / `gastro_core_test`), while AI Service defaults to `MONGODB_DB_NAME` (`gastrowise` / `gastro_ai_test`). In `docker-compose.yml`, `ai-service` reads `gastro_ai_test.restaurants`, which is empty unless seeded or pointed via least-privilege read-only credentials to `gastro_core.restaurants`.

---

## 2. Complete Collection Inventory

### 2.1 Active Registered Collections

| Collection | Owning Service | Schema Class | Registration Module | Active Relationships |
|---|---|---|---|---|
| `restaurants` | Core Service | `Restaurant` | `restaurants.module.ts`, `reviews.module.ts`, `internal.module.ts` | Optional `ownerId -> User` (`ObjectId`); read by AI Service |
| `menu_items` | Core Service | `MenuItem` | `restaurants.module.ts` | `restaurantId -> Restaurant` (`ObjectId`, required) |
| `reviews` | Core Service | `Review` | `reviews.module.ts` | `restaurantId -> Restaurant` (`ObjectId`, required); optional `userId -> User`; `urlGoc` string link |
| `users` | Core Service | `User` | `users.module.ts`, `favorites.module.ts` | `savedRestaurants[] -> Restaurant` (`ObjectId[]`) |
| `contacts` | Core Service | `Contact` | `contacts.module.ts` | Standalone |
| `user_interactions` | Core Service | `Interaction` | `interactions.module.ts` | `userId -> User` (`ObjectId`); `targetId` (opaque `string`) |
| `taste_dna_profiles` | Core Service | `TasteDnaProfile` | `taste-dna.module.ts` | `userId -> User` (`ObjectId`, unique) |
| `itineraries` | Planning Service | `Itinerary` (+ embedded `ItineraryStop[]`) | `itineraries.module.ts` | ADR-09 decoupled string scalars `user_id` & `stops[].restaurant_id` |

### 2.2 Unregistered / Orphaned Schema Files & Legacy Artifacts

The following schema files exist in `apps/core-service/src/**/schemas/` but are **NOT** registered in any `MongooseModule.forFeature([...])` call:
1. `apps/core-service/src/restaurants/schemas/chat-session.schema.ts` (`chat_sessions`)
2. `apps/core-service/src/favorites/schemas/favorite-collection.schema.ts` (`favoritecollections`)
3. `apps/core-service/src/users/schemas/audit-log.schema.ts` (`auditlogs`)
4. `apps/core-service/src/users/schemas/notification.schema.ts` (`notifications`)
5. **Collection Collision Risk:** `apps/core-service/src/users/schemas/user-interaction.schema.ts` (`UserInteraction`) targets `@Schema({ collection: 'user_interactions' })` with an incompatible schema (`actionType`, `restaurantId`, `menuItemId`, `metadata: string`) compared to active `Interaction` (`eventType`, `targetType`, `targetId`, `metadata: Object`).
6. **Legacy Monolith Duplicate Tree:** Root `src/` still holds pre-microservices copies of all schemas (`src/restaurants/schemas/...`, `src/itineraries/schemas/...`, etc.).

---

## 3. Detailed Schema & Validation Audit

### 3.1 `restaurants` (`apps/core-service/src/restaurants/schemas/restaurant.schema.ts`)
- **Fields & Types:** `tenQuan: string`, `cityId: string`, `diemTrungBinh: number`, `diaChi: string`, `gioMoCua: string`, `giaCa: string`, `tags: string`, `lat: number`, `lon: number`, `location: { type: 'Point', coordinates: [number, number] }`, `diemKhongGian/ViTri/ChatLuong/PhucVu/GiaCa: number`, `avatarUrl/urlGoc/slug/description/contactPhone: string`, `ownerId: ObjectId`, `reviewsCount: number (default 0)`, `status: enum ['open','closed','pending'] (required, default 'open')`, `isVerified: boolean (default false)`, `isFeatured: boolean (default false)`, `timestamps: true`.
- **Anomalies & Integrity Risks:**
  - **Dual Rating Scale Corruption:** Foody crawler rows store `diemTrungBinh` in `[0, 10]`, whereas `ReviewsService.create` overwrites `diemTrungBinh` with 5-star review averages `[1, 5]` without a `ratingScale` metadata field.
  - **GeoJSON Default Trap:** `location.coordinates` defaults to `[106.7009, 10.7769]` (District 1, HCMC) if omitted on insert, potentially mislocating non-HCMC or coordinate-less restaurants into `$geoNear` Q1 queries.
  - **Non-Unique `slug` & Missing `ownerId` / `urlGoc` Indexes:** Both `slug` and `urlGoc` are used as lookup identifiers in `findOne()` / `ReviewsService`.

### 3.2 `users` (`apps/core-service/src/users/schemas/user.schema.ts`)
- **Fields & Types:** `username (required, unique)`, `email (required, unique)`, `password (required)`, `picture`, `firstName`, `lastName`, `phone`, `company`, `designation`, `bio`, `role (required, enum ['user','admin','owner'], default 'user')`, `preferences: string[]`, `savedRestaurants: ObjectId[]`, `status (required, enum ['active','banned'], default 'active')`, `twoFactorSecret`, `isTwoFactorEnabled (default false)`, `resetOtp`, `timestamps: true`.
- **Critical Schema Defect (`hashedRefreshToken`):**
  - Line 49 declares `hashedRefreshToken?: string;` **without a `@Prop()` decorator**. Mongoose's default `strict: true` excludes `hashedRefreshToken` from the schema, silently discarding `UsersService.updateRefreshToken()` writes (`{ hashedRefreshToken: refreshToken }`).
- **Additional Risks:**
  - `resetOtp` has no `resetOtpExpiresAt` timestamp or TTL index.
  - `savedRestaurants: ObjectId[]` is an unbounded array with no orphan cleanup when a restaurant is removed.

### 3.3 `reviews` (`apps/core-service/src/reviews/schemas/review.schema.ts`)
- **Fields & Types:** `tenQuan`, `urlGoc (index)`, `diemReview: number`, `noiDung`, `aiSentimentLabel`, `aiSentimentScore`, `hashtags: string[]`, `userId (ObjectId, optional)`, `userName`, `restaurantId (ObjectId, required, ref Restaurant)`, `images: string[]`, `likes (default 0)`, `status (enum ['active','hidden','pending'], default 'active')`, `isFeatured (default false)`, `pinnedAt (default null)`, `timestamps: true`.
- **Anomalies:** `diemReview` lacks `min: 1, max: 5` schema bounds; legacy/crawled reviews rely on `urlGoc` instead of `restaurantId` when backfilling.

### 3.4 `menu_items` (`apps/core-service/src/restaurants/schemas/menu-item.schema.ts`)
- **Fields & Types:** `restaurantId (ObjectId, required)`, `name (required)`, `description`, `price (required)`, `image`, `isVegetarian (default false)`, `calories`, `tags: string[]`, `isAvailable (default true)`, `isFeatured (default false)`, `timestamps: true`.
- **Anomalies:** Zero custom indexes despite direct filtering by `restaurantId` and sorting by `{ isFeatured: -1, createdAt: -1 }`. Missing `min: 0` validation on `price` and `calories`.

### 3.5 `user_interactions` (`apps/core-service/src/interactions/schemas/interaction.schema.ts`)
- **Fields & Types:** `userId (ObjectId, index)`, `sessionId (index)`, `eventType (required, enum, index)`, `targetType (required, enum)`, `targetId (string, required, index)`, `durationMs (default 0)`, `metadata (Object, default {})`, `timestamps: true`.
- **Anomalies:** Unbounded telemetry growth (no TTL retention policy). `eventType` values (`review_submit`, `itinerary_add`) do not map 1:1 to AI CF `EVENT_WEIGHTS` keys (`REVIEW`, `SAVE`, `TOUR_COMPLETE`), falling back to weight `1.0` unless explicitly rated.

### 3.6 `taste_dna_profiles` (`apps/core-service/src/taste-dna/schemas/taste-dna.schema.ts`)
- **Fields & Types:** `userId (ObjectId, required, unique, index)`, 6-D flavor floats (`spicy`, `sweet`, `sour`, `salty`, `umami`, `bitter`, all `default 0.5, min 0.0, max 1.0`), `favoriteCuisines: string[]`, `dietaryRestrictions: string[]`, `dislikedIngredients: string[]`, `budgetPreference (enum ['budget','medium','fine_dining'], default 'medium')`, `confidenceScore (default 0.3, min 0, max 1)`, `interactionCount (default 0)`.
- **Assessment:** Well-constrained numeric bounds; redundant `index: true` + `unique: true` on `userId` (unique already creates an index).

### 3.7 `contacts` (`apps/core-service/src/contacts/schemas/contact.schema.ts`)
- **Fields & Types:** `name (req)`, `phone (req)`, `email (req)`, `topic (enum ContactTopic, req, default 'FEEDBACK')`, `message (req)`, `aiClassification (default 'Chờ phân tích')`, `status (default 'CHỜ XỬ LÝ')`, audit fields (`resolvedBy`, `processingAt`, `resolvedAt`), `timestamps: true`.
- **Anomalies:** `status` has no enum validator; zero indexes on collection (`contacts.service.ts` runs unbounded `.find().sort({ createdAt: -1 })`).

### 3.8 `itineraries` (`apps/planning-service/src/itineraries/schemas/itinerary.schema.ts`)
- **Fields & Types:** `user_id (string, req, index)`, `prompt`, `title`, `start_time`, `end_time`, `budget`, `start_location: { type: 'Point', coordinates: number[] }`, `status (default 'generated')`, embedded `stops: ItineraryStop[]`, `shareToken`, `reminderEnabled`, `reminderTime`, `co2SavedKg`, `total_distance_km`, `total_duration_mins`, `total_cost`, `remaining_budget`, `desired_stops`, `routing_mode (enum ['motorbike','car','walking'])`, `optimizedBy`, `created_at (Date.now)`, audit fields (`confirmed*`, `cancelled*`, `completed*`), `timestamps: true`.
- **Anomalies:** Duplicate timestamp storage (`createdAt` from `timestamps: true` AND manual `created_at`) plus **3 redundant indexes on `user_id`** (`user_id: 1`, `{ user_id: 1, created_at: -1 }`, `{ user_id: 1, createdAt: -1 }`). Missing `shareToken` sparse unique index. Embedded `stops[]` stores Point-in-Time snapshots (~1-50 stops typical, low bloat risk, though staleness is inherent to snapshot pattern).

---

## 4. Index Inventory & Query Performance Audit

| Collection | Existing Declared Indexes | Active Query / Sort Patterns Observed in Code | Gaps / Performance Risks |
|---|---|---|---|
| `restaurants` | `_id`, `cityId`, `slug`, `{location:'2dsphere'}`, `{status:1, diemTrungBinh:-1}`, `{tenQuan:'text', tags:'text'}` | `$geoNear(status, location)`; `.find({_id:{$in:...}})`; `.find({}).sort({diemTrungBinh:-1, reviewsCount:-1})`; `.findOne({urlGoc:{$regex}})`; `.find({$or:[location missing]})`; regex on `diaChi`/`tags`; in-memory manual slice | **Missing** `{diemTrungBinh:-1, reviewsCount:-1}`, **missing** `urlGoc`, **unused** `cityId` index; `isManualProcessing` loads all matching rows into RAM |
| `menu_items` | `_id` only | `.find({restaurantId})`; `.find(filter).sort({isFeatured:-1, createdAt:-1})` | **Missing** `{restaurantId:1, isFeatured:-1, createdAt:-1}` (`COLLSCAN` on every menu fetch) |
| `reviews` | `_id`, `urlGoc`, `{restaurantId:1, createdAt:-1}`, `{restaurantId:1, status:1, createdAt:-1}` | `.find({restaurantId}).sort({isFeatured:-1, createdAt:-1})`; `.find({urlGoc}).sort({isFeatured:-1, createdAt:-1})`; `.find(filter).sort({isFeatured:-1, createdAt:-1})`; `.find({aiSentimentLabel:{$exists:false}})` | **Missing** `isFeatured: -1` in compound sort indexes (forces blocking in-memory sort); unindexed `$exists: false` backfill scan |
| `users` | `_id`, `username (unique)`, `email (unique)` | `.findById`, `.findOne({email})`, admin `.find(filter).sort({createdAt:-1})` | **Missing** `{status:1, createdAt:-1}` for paginated admin user tables |
| `user_interactions` | `_id`, `userId`, `sessionId`, `eventType`, `targetId`, `{userId:1,createdAt:-1}`, `{targetId:1,eventType:1}`, `{createdAt:-1}` | `.find({userId}).sort({createdAt:-1})`, `.aggregate({$match:{targetType}})`, `.find({userId:{$exists:true,$ne:null}}).sort({createdAt:-1})` | **Redundant** single `userId` & `targetId` indexes; **missing** `{targetType:1, targetId:1}` and optional TTL index |
| `taste_dna_profiles` | `_id`, `userId (unique + index)` | `.findOne({userId})` | Redundant `index: true` alongside `unique: true` |
| `contacts` | `_id` only | `.find().sort({createdAt:-1})` | **Missing** `{createdAt:-1}` and pagination limit (`COLLSCAN` + full sort) |
| `itineraries` | `_id`, `user_id`, `{user_id:1,created_at:-1}`, `{user_id:1,createdAt:-1}` | `.find({user_id}).sort({created_at:-1})`, `.find().sort({created_at:-1})`, `.findById` | **Redundant** 3 indexes on `user_id` + dual `created_at`/`createdAt`; **missing** sparse `shareToken` & `{status:1, created_at:-1}` |

*Note: Zero TTL indexes currently exist across any schema.*
