# M8.2 — MongoDB Schema & Index Deep Audit (Technical Reference)

- **Repository:** `maanxx/KLTN-123-GastroWise-BE`
- **Branch:** `feature/m8-2-schema-index-audit` (based on `origin/feature/m8-1-database-architecture-audit` `057eb643463f9eeb7f898003a86c39d838ea20bd`)
- **Audit Mode:** Static read-only source-code inspection across `apps/core-service`, `apps/planning-service`, `src/`, `scripts/`, and read-only cross-reference to `KLTN-123-GastroWise-AI`. **Zero live MongoDB queries, runtime `explain()` plans, or schema edits were executed.**

---

## 1. Executive Summary

- **Schema Inventory:** `28` `@Schema()` decorators exist across the repository (`14` inside `apps/`, `14` legacy duplicates inside `src/`). Only `9` `@Schema()` classes (`8` top-level models + `1` embedded subdocument `ItineraryStop`) are registered at runtime in `apps/`, mapping to `8` active MongoDB collections across `Core` (`7`) and `Planning` (`1`). `5` schema files in `apps/core-service/` are unregistered dead code, including `user-interaction.schema.ts` which collides on the `user_interactions` collection name.
- **Index Inventory:** `29` indexes exist across the `8` active collections (`8` automatic `_id` + `21` custom declared indexes), with **0 TTL indexes**, `1` geospatial `2dsphere` index, `1` text index, `3` unique constraints, and `5` redundant indexes.
- **Top Integrity & Performance Risks:**
  - `User.hashedRefreshToken` lacks `@Prop()` (`user.schema.ts:49`), silently stripping refresh-token persistence, while `AuthService` passes plaintext refresh tokens vs. `bcrypt.compare`.
  - `User.resetOtp` lacks an expiration timestamp (`resetOtpExpiresAt`) despite 15-minute expiry claims in email copy (`auth.service.ts:311,365`).
  - `menu_items`, `contacts`, and `reviews` (`isFeatured: -1` sorts) lack query-aligned indexes.
  - `restaurants.diemTrungBinh` mixes `0–10` and `0–5` rating scales without `ratingScale` metadata.

---

## 2. Collection-to-Service Ownership Matrix

| Collection | Owning DB (`AppModule`) | Owning Service | Schema File | Registered Model Name | AI Access |
|---|---|---|---|---|---|
| `restaurants` | `gastro_core` (`CORE_DB_NAME`) | Core Service | `apps/core-service/src/restaurants/schemas/restaurant.schema.ts` | `Restaurant` | PyMongo Read-Only (`MONGODB_DB_NAME`) |
| `menu_items` | `gastro_core` | Core Service | `apps/core-service/src/restaurants/schemas/menu-item.schema.ts` | `MenuItem` | None (via Core) |
| `reviews` | `gastro_core` | Core Service | `apps/core-service/src/reviews/schemas/review.schema.ts` | `Review` | Text sent to `/analyze-sentiment` |
| `users` | `gastro_core` | Core Service | `apps/core-service/src/users/schemas/user.schema.ts` | `User` | None |
| `contacts` | `gastro_core` | Core Service | `apps/core-service/src/contacts/schemas/contact.schema.ts` | `Contact` | None |
| `user_interactions` | `gastro_core` | Core Service | `apps/core-service/src/interactions/schemas/interaction.schema.ts` | `Interaction` | Synced to `/cf/train` |
| `taste_dna_profiles` | `gastro_core` | Core Service | `apps/core-service/src/taste-dna/schemas/taste-dna.schema.ts` | `TasteDnaProfile` | Vector passed to `/recommend/hybrid` |
| `itineraries` | `gastro_planning` (`PLANNING_DB_NAME`) | Planning Service | `apps/planning-service/src/itineraries/schemas/itinerary.schema.ts` | `Itinerary` (+ `ItineraryStop[]`) | Stops sent to `/routes/optimize` |

---

## 3. Complete Schema Inventory (Observed Field-Level Details)

1. **`Restaurant` (`restaurants`, `apps/core-service/src/restaurants/schemas/restaurant.schema.ts:7-82`, `timestamps: true`)**
   - Strings: `tenQuan`, `cityId` (`index`), `diaChi`, `gioMoCua`, `giaCa`, `tags`, `avatarUrl`, `urlGoc`, `slug` (`index`), `description`, `contactPhone`, `status` (`required`, `default: 'open'`, `enum: ['open','closed','pending']`).
   - Numbers: `diemTrungBinh`, `lat`, `lon`, `diemKhongGian`, `diemViTri`, `diemChatLuong`, `diemPhucVu`, `diemGiaCa`, `reviewsCount` (`default: 0`).
   - Booleans: `isVerified` (`default: false`), `isFeatured` (`default: false`).
   - Refs / GeoJSON: `ownerId` (`ObjectId` ref `'User'`, optional), `location` (`type: enum ['Point'] default 'Point'`, `coordinates: [Number] default [106.7009, 10.7769]`).
   - Missing: `ratingScale`, `rawRating`, `schemaVersion`, numeric `min/max` bounds, conditional/null GeoJSON default (currently defaults missing locations to District 1 HCMC).

2. **`MenuItem` (`menu_items`, `apps/core-service/src/restaurants/schemas/menu-item.schema.ts:6-44`, `timestamps: true`)**
   - Fields: `restaurantId` (`ObjectId` ref `'Restaurant'`, `required`), `name` (`string`, `required`), `description` (`string`), `price` (`number`, `required`), `image` (`string`), `isVegetarian` (`boolean`, `default: false`), `calories` (`number`), `tags` (`string[]`, `default: []`), `isAvailable` (`boolean`, `default: true`), `isFeatured` (`boolean`, `default: false`).
   - Issues: Zero custom indexes; missing `min: 0` on `price`/`calories`; no category field.

3. **`Review` (`reviews`, `apps/core-service/src/reviews/schemas/review.schema.ts:6-64`, `timestamps: true`)**
   - Fields: `tenQuan`, `urlGoc` (`index`), `diemReview` (`number`), `noiDung`, `aiSentimentLabel`, `aiSentimentScore` (`number`), `hashtags` (`string[]`, `default: []`), `userId` (`ObjectId` ref `'User'`, `required: false`), `userName`, `restaurantId` (`ObjectId` ref `'Restaurant'`, `required: true`), `images` (`string[]`, `default: []`), `likes` (`number`, `default: 0`), `status` (`enum: ['active','hidden','pending']`, `default: 'active'`), `isFeatured` (`boolean`, `default: false`), `pinnedAt` (`Date`, `default: null`).
   - Issues: No `min: 1, max: 5` on `diemReview`; no `{ userId: 1, restaurantId: 1 }` duplicate review guard; no `isFeatured: -1` in sort indexes.

4. **`User` (`users`, `apps/core-service/src/users/schemas/user.schema.ts:7-106`, `timestamps: true`)**
   - Fields: `username` (`required`, `unique`), `email` (`required`, `unique`), `password` (`required`, pre-save bcrypt hook), `picture`, `firstName`, `lastName`, `phone`, `company`, `designation`, `bio`, `role` (`required`, `default: 'user'`, `enum: ['user','admin','owner']`), `preferences` (`string[]`, `default: []`), `savedRestaurants` (`ObjectId[]` ref `'Restaurant'`, `default: []`), `status` (`required`, `default: 'active'`, `enum: ['active','banned']`), `twoFactorSecret`, `isTwoFactorEnabled` (`default: false`), `resetOtp` (`string`).
   - **Critical Fields:** `hashedRefreshToken` (line `49`) lacks `@Prop()` decorator; `resetOtp` (line `91`) lacks `resetOtpExpiresAt` timestamp/TTL. `toJSON`/`toObject` delete sensitive keys.

5. **`Contact` (`contacts`, `apps/core-service/src/contacts/schemas/contact.schema.ts:13-50`, `timestamps: true`)**
   - Fields: `name` (`req`), `phone` (`req`), `email` (`req`), `topic` (`req`, `enum: ContactTopic`, `default: 'FEEDBACK'`), `message` (`req`), `aiClassification` (`default: 'Chờ phân tích'`), `status` (`default: 'CHỜ XỬ LÝ'`, no enum), audit (`resolvedBy: string | null`, `processingAt: Date | null`, `resolvedAt: Date | null`).

6. **`Interaction` (`user_interactions`, `apps/core-service/src/interactions/schemas/interaction.schema.ts:27-60`, `timestamps: true`)**
   - Fields: `userId` (`ObjectId` ref `'User'`, `index`), `sessionId` (`string`, `index`), `eventType` (`req`, `enum`, `index`), `targetType` (`req`, `enum`), `targetId` (`string`, `req`, `index`), `durationMs` (`default: 0`), `metadata` (`Object`, `default: {}`).

7. **`TasteDnaProfile` (`taste_dna_profiles`, `apps/core-service/src/taste-dna/schemas/taste-dna.schema.ts:7-58`, `timestamps: true`)**
   - Fields: `userId` (`ObjectId` ref `'User'`, `required`, `unique`, `index`), `spicy/sweet/sour/salty/umami/bitter` (`default: 0.5, min: 0.0, max: 1.0`), `favoriteCuisines`/`dietaryRestrictions`/`dislikedIngredients` (`string[]`, `default: []`), `budgetPreference` (`enum: ['budget','medium','fine_dining']`, `default: 'medium'`), `confidenceScore` (`default: 0.3, min: 0, max: 1`), `interactionCount` (`default: 0`).

8. **`Itinerary` + Embedded `ItineraryStop` (`itineraries`, `apps/planning-service/src/itineraries/schemas/itinerary.schema.ts:4-153`, `timestamps: true`)**
   - Top-level: `user_id` (`string`, `req`, `index`), `prompt`, `title`, `start_time`, `end_time`, `budget`, `start_location` (`Point` GeoJSON without `2dsphere` index), `status` (`default: 'generated'`, no enum), `stops: ItineraryStop[]`, `shareToken`, `reminderEnabled`, `reminderTime`, `co2SavedKg`, `total_distance_km`, `total_duration_mins`, `total_cost`, `remaining_budget`, `desired_stops`, `routing_mode` (`enum: ['motorbike','car','walking']`), `optimizedBy`, `created_at` (`Date.now`), audit fields (`confirmed*`, `cancelled*`, `completed*`).
   - Embedded `ItineraryStop`: `stop_id`, `restaurant_id` (`string`, `req`), `order_index`, `restaurant_name`, `restaurant_lat`, `restaurant_lng`, `restaurant_address`, `restaurant_rating`, `restaurant_image`, `meal_type` (`enum`), `arrival_time`, `departure_time`, `dining_duration_mins`, `transit_time_mins`, `distance_to_next_km`, `estimated_cost`, `tags`.

9. **Unregistered / Orphaned Schemas (`apps/core-service/src/`) & Legacy Monolith (`src/`):**
   - `ChatSession` (`chat_sessions`), `FavoriteCollection` (`favoritecollections`), `AuditLog` (`auditlogs`), `Notification` (`notifications`), `UserInteraction` (`user_interactions` — **schema collision**), plus `14` legacy `@Schema()` declarations under `src/`.

---

## 4. Complete Index Inventory

| Collection | Index Keys | Type | Declared In Code (`file:line`) | Redundant? | Query Supported |
|---|---|---|---|---|---|
| `restaurants` | `{ _id: 1 }` | Auto Unique | Mongoose default | No | `findById`, `_id: {$in}` |
| `restaurants` | `{ cityId: 1 }` | Single | `restaurant.schema.ts:10` | **Unused** | None observed in `restaurants.service.ts` |
| `restaurants` | `{ slug: 1 }` | Single | `restaurant.schema.ts:49` | No | `findOne({ slug })`, `createMenuItem` |
| `restaurants` | `{ location: '2dsphere' }` | Geospatial | `restaurant.schema.ts:76` (+ `migrate-geojson.ts:73`) | Overlap with migration script if options differ | `findNearby` `$geoNear` |
| `restaurants` | `{ status: 1, diemTrungBinh: -1 }` | Compound | `restaurant.schema.ts:79` | No | Filtered status + rating sort |
| `restaurants` | `{ tenQuan: 'text', tags: 'text' }` | Text | `restaurant.schema.ts:82` | **Unused by regex** | Only `$text` queries (code currently uses `$regex`) |
| `menu_items` | `{ _id: 1 }` | Auto Unique | Mongoose default | No | `findByIdAndUpdate` / `Delete` |
| `reviews` | `{ _id: 1 }` | Auto Unique | Mongoose default | No | `findById` / `Update` / `Delete` |
| `reviews` | `{ urlGoc: 1 }` | Single | `review.schema.ts:12` | Partial | `findByRestaurantUrl({ urlGoc })` |
| `reviews` | `{ restaurantId: 1, createdAt: -1 }` | Compound | `review.schema.ts:63` | Superseded if `status` included, lacks `isFeatured` | `aggregate($match:{restaurantId})` |
| `reviews` | `{ restaurantId: 1, status: 1, createdAt: -1 }` | Compound | `review.schema.ts:64` | No | Moderated listing (without `isFeatured`) |
| `users` | `{ _id: 1 }` | Auto Unique | Mongoose default | No | `findById`, `updateRefreshToken` |
| `users` | `{ username: 1 }` | Unique | `user.schema.ts:37` | No | Signup uniqueness |
| `users` | `{ email: 1 }` | Unique | `user.schema.ts:40` | No | `findOneByEmail` (login, forgotPassword) |
| `contacts` | `{ _id: 1 }` | Auto Unique | Mongoose default | No | `findByIdAndUpdate` |
| `user_interactions` | `{ _id: 1 }` | Auto Unique | Mongoose default | No | Primary ID |
| `user_interactions` | `{ userId: 1 }` | Single | `interaction.schema.ts:29` | **Yes** (prefix of `{userId:1,createdAt:-1}`) | Covered by compound |
| `user_interactions` | `{ sessionId: 1 }` | Single | `interaction.schema.ts:32` | No | Anonymous session tracking |
| `user_interactions` | `{ eventType: 1 }` | Single | `interaction.schema.ts:38` | Low cardinality | Filtered event counts |
| `user_interactions` | `{ targetId: 1 }` | Single | `interaction.schema.ts:45` | **Yes** (prefix of `{targetId:1,eventType:1}`) | Covered by compound |
| `user_interactions` | `{ userId: 1, createdAt: -1 }` | Compound | `interaction.schema.ts:58` | No | `getUserInteractions` |
| `user_interactions` | `{ targetId: 1, eventType: 1 }` | Compound | `interaction.schema.ts:59` | No | Target event analytics |
| `user_interactions` | `{ createdAt: -1 }` | Single | `interaction.schema.ts:60` | No | `getMatrixExport` time sort |
| `taste_dna_profiles` | `{ _id: 1 }` | Auto Unique | Mongoose default | No | Primary ID |
| `taste_dna_profiles` | `{ userId: 1 }` | Unique | `taste-dna.schema.ts:13-14` | **Redundant flag** (`unique:true` + `index:true`) | `getProfile({ userId })` |
| `itineraries` | `{ _id: 1 }` | Auto Unique | Mongoose default | No | `findById` across CRUD/state machine |
| `itineraries` | `{ user_id: 1 }` | Single | `itinerary.schema.ts:63` | **Yes** (prefix of compounds) | Covered by compound |
| `itineraries` | `{ user_id: 1, created_at: -1 }` | Compound | `itinerary.schema.ts:152` | Redundant w/ `createdAt` | `getItinerariesByUser` |
| `itineraries` | `{ user_id: 1, createdAt: -1 }` | Compound | `itinerary.schema.ts:153` | Dual timestamp drift | Unused in `.sort({ created_at: -1 })` |

---

## 5. Query-to-Index Mapping & Potential Unindexed Patterns (Code-Level)

*Disclaimer: Flagged as **Code-Level Potential COLLSCAN / Blocking Sort** pending live `explain('executionStats')` verification on MongoDB Atlas.*

| Service & Line | Query / Aggregation | Issue Classification | Recommended Supporting Index / Refactor |
|---|---|---|---|
| `restaurants.service.ts:122,136-138` | `menuItemModel.find({restaurantId}).sort({isFeatured:-1, createdAt:-1})` | **Potential COLLSCAN + SORT** | `{ restaurantId: 1, isFeatured: -1, createdAt: -1 }` on `menu_items` |
| `reviews.service.ts:251-252` | `reviewModel.find({urlGoc}).sort({isFeatured:-1, createdAt:-1})` | **Blocking SORT** after `urlGoc` scan | `{ urlGoc: 1, isFeatured: -1, createdAt: -1 }` on `reviews` |
| `reviews.service.ts:291-292,405-407` | `reviewModel.find({restaurantId / filter}).sort({isFeatured:-1, createdAt:-1})` | **Blocking SORT** (`isFeatured` missing in index) | `{ restaurantId: 1, isFeatured: -1, createdAt: -1 }` & `{ status: 1, isFeatured: -1, createdAt: -1 }` |
| `reviews.service.ts:436` | `reviewModel.find({ aiSentimentLabel: { $exists: false } })` | **Potential COLLSCAN** | Partial index or bounded migration batching |
| `restaurants.service.ts:612-615` & `favorites.service.ts:112-113` | `restaurants.find({}).sort({ diemTrungBinh: -1, reviewsCount: -1 })` | **Blocking SORT** (no `diemTrungBinh` leading index) | `{ diemTrungBinh: -1, reviewsCount: -1 }` on `restaurants` |
| `restaurants.service.ts:60-84` | `onApplicationBootstrap` `$or` missing `location` scan | **Startup COLLSCAN** on every boot | Move to offline M8.2 migration; remove runtime boot hook |
| `restaurants.service.ts:1028` & `reviews.service.ts:123` | `findOne({ urlGoc: { $regex: '...$' } })` | **Potential COLLSCAN** (`$regex` on unindexed field) | `{ urlGoc: 1 }` on `restaurants` + exact match instead of unanchored `$regex` |
| `restaurants.service.ts:932-991` | `isManualProcessing`: `.find(filterQuery).lean()` then JS `.slice()` | **Unbounded RAM & Pagination Risk** | Cap/push geo/sort into MongoDB aggregation pipeline |
| `favorites.service.ts:75-100` | `userModel.aggregate([$unwind:'$savedRestaurants', $group, $sort, $lookup restaurants])` | **Unbounded `$unwind` + `$lookup`** across all users | Add leading `{ $match: { 'savedRestaurants.0': { $exists: true } } }` & index `{ savedRestaurants: 1 }` |
| `contacts.service.ts:222` | `contactModel.find().sort({ createdAt: -1 })` | **Potential COLLSCAN + Unbounded** | `{ createdAt: -1 }` + add pagination (`limit`/`skip`) |
| `interactions.service.ts:96-111` | `aggregate([{$match:{targetType}}, {$group:{_id:'$targetId'}}])` | **Potential COLLSCAN** (`targetType` unindexed) | `{ targetType: 1, targetId: 1 }` on `user_interactions` |
| `itineraries.service.ts:439` | `itineraryModel.find().sort({ created_at: -1 })` | **Index miss / global sort** (leading `user_id` skipped) | `{ created_at: -1 }` (if admin global list remains) + pagination |

---

## 6. Prioritized Findings Register (P0 – P3)

### P0 — Critical Data Integrity / Security Risks

1. **[P0-01] `User.hashedRefreshToken` Undecorated + Plaintext Token Storage Mismatch**
   - **Evidence:** `apps/core-service/src/users/schemas/user.schema.ts:47-49`, `apps/core-service/src/users/users.service.ts:111-116`, `apps/core-service/src/auth/auth.service.ts:43,83,98,104,108`.
   - **Current Behavior:** `@Prop({ required: false })` annotates `picture?`, leaving `hashedRefreshToken?` excluded from Mongoose's schema under `strict: true`. Writes in `updateRefreshToken` are silently discarded, AND `AuthService` passes raw `tokens.refreshToken` instead of bcrypt-hashed tokens while `refresh()` executes `bcrypt.compare`.
   - **Impact:** Refresh token rotation (`POST /auth/refresh`) fails and `logout()` cannot invalidate tokens in DB.
   - **Recommended Fix:** Add `@Prop({ required: false, default: null }) hashedRefreshToken?: string;` and hash refresh tokens in `AuthService` before persistence.
   - **Migration / Backfill:** Set `{ hashedRefreshToken: null }` on legacy user docs to force clean re-issue; **Low risk** (non-destructive).

2. **[P0-02] `User.resetOtp` Missing Expiration Timestamp & Plaintext Console Log**
   - **Evidence:** `apps/core-service/src/users/schemas/user.schema.ts:90-91`, `apps/core-service/src/auth/auth.service.ts:278-280,311,316,365-369`.
   - **Current Behavior:** Email copy promises 15-minute expiry, yet no `resetOtpExpiresAt` field or server-side timestamp check exists; OTP never expires until overwritten/reset. OTP is also logged in plaintext (`auth.service.ts:316`).
   - **Impact:** Stale 6-digit OTPs remain valid indefinitely (security window vulnerability).
   - **Recommended Fix:** Add `@Prop({ type: Date, default: null }) resetOtpExpiresAt?: Date | null;`, validate `resetOtpExpiresAt > new Date()` in `resetPassword`, redact OTP from logs.
   - **Migration / Backfill:** Clear stale OTPs (`resetOtp: null, resetOtpExpiresAt: null`); **Low risk**.

3. **[P0-03] Collection Collision on `user_interactions` & Legacy `src/` Cross-DB Schema Divergence**
   - **Evidence:** `apps/core-service/src/interactions/schemas/interaction.schema.ts:27` vs. `apps/core-service/src/users/schemas/user-interaction.schema.ts:6`; `src/itineraries/schemas/itinerary.schema.ts:11-12,54-55` vs. `apps/planning-service/src/itineraries/schemas/itinerary.schema.ts:10-11,63-64`.
   - **Current Behavior:** Two conflicting classes target `collection: 'user_interactions'`. Legacy root `src/` schemas use `ObjectId` refs incompatible with ADR-09 microservices string IDs.
   - **Impact:** Accidental import of `UserInteraction` or `src/` schemas corrupts collection documents/validation.
   - **Recommended Fix:** Remove unregistered `users/schemas/user-interaction.schema.ts` and archive/remove legacy root `src/` duplicate tree once confirmed unused by build scripts.
   - **Migration / Backfill:** Verify live `user_interactions` documents against `Interaction` shape before removal; **Low risk** if import-checked first.

4. **[P0-04] Dual Rating Scales (`0–10` vs `0–5`) Mixed in `restaurants.diemTrungBinh`**
   - **Evidence:** `apps/core-service/src/restaurants/schemas/restaurant.schema.ts:12`, `apps/core-service/src/reviews/reviews.service.ts:168-174`, `apps/core-service/src/restaurants/restaurants.service.ts:822-855`.
   - **Current Behavior:** Foody catalog uses `[0, 10]` while `ReviewsService` overwrites `diemTrungBinh` with `[1, 5]` review averages without `ratingScale` / `rawRating` fields. Filter `lt6` matches 5-star restaurants alongside `< 6/10` crawled entries.
   - **Impact:** Incorrect rating filtering & sorting drift across Core & Planning.
   - **Recommended Fix:** Add `ratingScale` (`enum: ['10_point','5_point']`), `rawRating`, and `diemTrungBinh` `[0, 5]` standardized contract (or normalized `rating` field) via expand-contract migration.
   - **Migration / Backfill:** Batched backfill using `reviewsCount` & Foody subscore heuristics (`M7.1` rules) after snapshot; **Medium risk** (requires AI/FE coordination).

### P1 — High Performance or Correctness Risks

5. **[P1-01] Missing Compound/Sort Indexes on `menu_items`, `reviews`, `restaurants`, and `contacts`** (`menu-item.schema.ts:1-44`, `review.schema.ts:62-64`, `restaurant.schema.ts:75-82`, `contact.schema.ts:13-50`).
   - **Recommended Fix:** Add indexes using `{ background: true }` (`menu_items`, `reviews` with `isFeatured: -1`, `restaurants` rating & `urlGoc`, `contacts.createdAt`). **Low risk** when built in background.
6. **[P1-02] Core Boot-Time Full-Collection `COLLSCAN` & Misleading Q1 GeoJSON Default** (`restaurants.service.ts:51-118`, `restaurant.schema.ts:29-31`).
   - **Recommended Fix:** Remove `ensureGeoJsonLocations()` from `onApplicationBootstrap()` in favor of versioned migration; change `location` default to `undefined` so un-geocoded entries are not defaulted to `[106.7009, 10.7769]`. **Medium risk** (existing `$geoNear` relies on valid Points).
7. **[P1-03] Unbounded `$unwind` + `$lookup` Favorites Query & Dangling Orphan Refs** (`favorites.service.ts:75-100`, `user.schema.ts:75-79`, `review.schema.ts:36-41`, `restaurants.service.ts:1079-1084`).
   - **Recommended Fix:** Pre-filter `$match: { 'savedRestaurants.0': { $exists: true } }`, add multikey index on `users.savedRestaurants`, and cascade-pull/soft-delete on restaurant removal. **Low risk**.
8. **[P1-04] Missing Schema Validators & Query Role Bug** (`users.service.ts:32-33` `'merchant'` vs `user.schema.ts:69` `'owner'`; `review.schema.ts:15-16` missing `1..5`; `menu-item.schema.ts:21,30` missing `min: 0`; `contact.schema.ts:33` unvalidated status; `review` missing `{ userId: 1, restaurantId: 1 }` uniqueness).
   - **Recommended Fix:** Fix `'owner'` query filter, add numeric bounds/enums, add partial unique review index after deduplicating existing reviews. **Medium risk** (unique index fails if duplicates exist in prod).

### P2 — Medium Optimization & Maintainability Issues

9. **[P2-01] Duplicate `created_at`/`createdAt` & Redundant Indexes on `itineraries`, `user_interactions`, `taste_dna_profiles`** (`itinerary.schema.ts:60,63,127,152-153`, `interaction.schema.ts:29,45,58-59`, `taste-dna.schema.ts:13-14`).
   - **Recommended Fix:** Standardize on `createdAt` (`timestamps: true`), drop redundant single-field prefix indexes, add `{ shareToken: 1 }` sparse unique index on `itineraries`. **Low risk**.
10. **[P2-02] Zero TTL Indexes & Unbounded Telemetry Growth** (`interaction.schema.ts:27-60`, `interactions.service.ts:117-125`).
    - **Recommended Fix:** Consider 180-day TTL on raw `view`/`search` events (keeping `review_submit`/`favorite`/`itinerary_complete`) or archival aggregation, plus `{ targetType: 1, targetId: 1 }`. **Low risk** if scoped carefully.
11. **[P2-03] Unused `cityId` Index on `restaurants`** (`restaurant.schema.ts:10-11` vs `DiaChi` regex in `restaurants.service.ts:808-820`).
    - **Recommended Fix:** Either backfill/use `cityId` in queries or drop unused index.

### P3 — Low-Priority Cleanup

12. **[P3-01] Unregistered Orphaned Schema Files (`chat-session`, `favorite-collection`, `audit-log`, `notification`)** (`apps/core-service/src/**/schemas/`).
    - **Recommended Fix:** Remove or register behind active modules when implementing those features; add `schemaVersion` (`default: 1`) across active schemas during M8.3+ migration rollout.

---

## 7. Runtime Verification Limitations

- No live MongoDB Atlas connection was opened during this audit.
- Index sizes, index hit ratios, live document counts, duplicate key checks (`Review` / `slug`), and actual `explain('executionStats')` plans remain **unverified at runtime** and must be checked against a restored staging snapshot prior to M8.3+ schema changes.
