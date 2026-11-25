# M8.6 — Data Integrity Verification & Consistency Audit

- **Repository:** `maanxx/KLTN-123-GastroWise-BE`
- **Branch:** `feature/m8-6-data-integrity-audit` (branched from M8.5 `feature/m8-5-disaster-recovery` `04995fc5aea8442c415f587aa9c222994d156293`)
- **Related Docs:** [`M8_6_INTEGRITY_VALIDATION_MATRIX.md`](./M8_6_INTEGRITY_VALIDATION_MATRIX.md), [`M8_6_AUTOMATED_TEST_STRATEGY.md`](./M8_6_AUTOMATED_TEST_STRATEGY.md), [`M8_2_SCHEMA_INDEX_AUDIT.md`](./M8_2_SCHEMA_INDEX_AUDIT.md)
- **Verification Scope:** Static code & DTO/schema inspection + in-memory Mongoose/class-validator fixture tests (`data-integrity.spec.ts`). **Zero production/staging MongoDB queries executed.**

---

## 1. Executive Summary

Audit of GastroWise's 3 validation layers (API `ValidationPipe` DTOs → Mongoose Schemas → MongoDB Server) revealed **zero MongoDB `$jsonSchema` collection validators**, global `ValidationPipe({ whitelist: false, transform: true })` in both services (`apps/core-service/src/main.ts:20`, `apps/planning-service/src/main.ts:29`), and **`runValidators: true` omitted on all `findByIdAndUpdate` calls**, allowing update operations to bypass Mongoose constraints. Additionally, critical confirmed defects were discovered in `CreateReviewDto` (`@Max(10)` vs 5-star review invariant), `CreateUserDto` (misplaced `@IsUrl()` on `firstName`), `CreateRestaurantDto` (empty DTO), missing cascade deletes, and missing case-insensitive email normalization.

---

## 2. Database Entity & Validation Layer Inventory (M8.6.1 & M8.6.3)

| Entity (`Collection`) | API Request DTO Validation | Mongoose Schema Validation | MongoDB Server `$jsonSchema` | Business Invariants & Gaps |
|---|---|---|---|---|
| `Restaurant` (`restaurants`) | `CreateRestaurantDto` **EMPTY (`{}`)** (`create-restaurant.dto.ts:1`) | `status` (`req`, enum), `reviewsCount` (`default: 0`), GeoJSON `Point` default | None | No `tenQuan`/`diaChi` required constraint, no rating scale bounds, Q1 `[106.7009, 10.7769]` fallback on missing `location` |
| `MenuItem` (`menu_items`) | Untyped `dto: any` (`restaurants.service.ts:142`) | `restaurantId` (`req`, `ObjectId`), `name` (`req`), `price` (`req`) | None | Missing `min: 0` on `price`/`calories` |
| `Review` (`reviews`) | `CreateReviewDto`: `diemReview` `@Min(1) @Max(10)`, `restaurantId` `@IsString()` | `restaurantId` (`req`, `ObjectId`), `status` enum, `likes` (`default: 0`) | None | **Scale conflict:** DTO accepts `6–10` while review averages overwrite `diemTrungBinh` with `reviewsCount > 0` (corrupting AI `5_point` detection) |
| `User` (`users`) | `CreateUserDto` (`@IsUrl()` mis-applied to `firstName`!), `UpdateUserDto` (`MaxLength(300)` bio) | `username`/`email` (`req`, `unique`), `password` (`req`), `role` enum, `status` enum | None | `hashedRefreshToken` undecorated (`user.schema.ts:49`); `resetOtp` has no `resetOtpExpiresAt`; no lowercase email normalization |
| `Contact` (`contacts`) | `CreateContactDto` (VN phone regex, `@IsEmail`, `@IsEnum(ContactTopic)`, `message >= 10`) | `name`/`phone`/`email`/`topic`/`message` (`req`), `topic` enum | None | `status` has no schema enum (`contact.schema.ts:33`); updates pass unvalidated `newStatus: string` |
| `Interaction` (`user_interactions`) | `CreateInteractionDto` (`@IsEnum` on `eventType` & `targetType`), `BatchInteractionDto` | `eventType` (`req`, enum), `targetType` (`req`, enum), `targetId` (`req`, string) | None | `insertMany(..., { ordered: false })` skips schema-level `userId` referential verification |
| `TasteDnaProfile` (`taste_dna_profiles`) | `UpdateTasteDnaDto`: 6 flavor dims `@Min(0) @Max(1)` | `userId` (`req`, `unique`), 6 dims `min:0, max:1`, `budgetPreference` enum, `confidenceScore` `[0,1]` | None | `UpdateTasteDnaDto.budgetPreference` lacks `@IsEnum` at API layer |
| `Itinerary` (`itineraries`) | `GenerateItineraryDto`: `@IsNotEmpty` on `prompt`/`start_time`/`end_time` | `user_id` (`req`, string), `routing_mode` enum, embedded `ItineraryStop` (`restaurant_id` `req`, `meal_type` enum) | None | `status` has no enum; `budget`/`lat`/`lng` lack `@Min`/`@Max` bounds; `order_index` fixed to 1-based in M7.3.9 |

---

## 3. Referential Integrity Audit (M8.6.2)

MongoDB enforces **zero foreign-key constraints**. Audit across `apps/` identified:

| Source (`Field`) | Target (`Field`) | Expected Invariant | Confirmed Failure Scenario | Recommended Mitigation |
|---|---|---|---|---|
| `menu_items.restaurantId` | `restaurants._id` | Every menu item belongs to an existing restaurant | `RestaurantsService.remove(id)` (`restaurants.service.ts:1083`) deletes restaurant without deleting child `menu_items` → **orphans** | Cascade delete (`menuItemModel.deleteMany({ restaurantId })`) or soft-delete `status: 'deleted'` |
| `reviews.restaurantId` | `restaurants._id` | Every review targets an existing restaurant | Deleting a restaurant leaves orphan reviews; `ReviewsService.create` accepts slug string and runs `new Types.ObjectId()` without re-validating if slug wasn't found (`reviews.service.ts:117-135`) | Validate resolved ID with `Types.ObjectId.isValid` & existence check (`NotFoundException`); archive/cascade on delete |
| `reviews.userId` | `users._id` | Optional author references valid user | `UsersService.remove(id)` leaves `userId` dangling on reviews (`populate` returns `null`) | Nullify `userId` / retain `userName` snapshot on user deletion |
| `users.savedRestaurants[]` | `restaurants._id` | Embedded array contains valid non-duplicate restaurant `ObjectId`s | Deleted restaurant leaves dangling `ObjectId` (`$unwind` + `$lookup` skips silently; `getUserFavorites` populates `null` entries if filtered lazily) | `$pull` deleted restaurant IDs from `users.savedRestaurants` on delete + filter `null` populated refs |
| `taste_dna_profiles.userId` | `users._id` | Strict `1:1` profile per existing user | Deleting user leaves orphaned `taste_dna_profiles` row | Cascade delete profile in `UsersService.remove` |
| `user_interactions.userId` | `users._id` | Optional valid user `ObjectId` | Invalid `userId` string silently omitted by `recordEvent` (`interactions.service.ts:30`) leaving unattributed row | Acceptable for anonymous sessions (`sessionId`), validate explicit `userId` on authenticated routes |
| `itineraries.user_id` & `stops[].restaurant_id` | Cross-DB `users._id` / `restaurants._id` | Scalar strings (ADR-09); restaurant metadata snapshotted in `stops[]` | Snapshot becomes stale if restaurant closes or changes address/price after tour creation | Intended ADR-09 trade-off; validate restaurant existence via `CoreApiClient` during `generateItinerary`/`addStop` |

---

## 4. Duplicate & Uniqueness Audit (M8.6.4)

| Entity | Existing Unique Indexes | Confirmed Uniqueness / Race Risk | Business Rule & Recommended Guard |
|---|---|---|---|
| `users` | `username_1`, `email_1` | Case-sensitive unique index + no `.toLowerCase().trim()` normalization in `UsersService.create` or `findOneByEmail`; `AuthService.signInWithGoogle` generates `email.split('@')[0]` as `username` (`auth.service.ts:196`) which collides on `E11000` if two providers/domains share local-part (`a@gmail.com` vs `a@yahoo.com`) | Normalize `email` lowercase; handle `E11000` gracefully & disambiguate Google `username` |
| `taste_dna_profiles` | `userId_1` (`unique: true`) | Safe if atomic `findOneAndUpdate(..., { upsert: true })` used; concurrent first-time requests without `upsert` race to `E11000` | Use atomic `$setOnInsert` upsert |
| `reviews` | None | One user can submit unlimited concurrent duplicate reviews for the same restaurant (distorting average rating & sentiment aggregates) | Add partial unique index `{ userId: 1, restaurantId: 1 }` (`userId: { $type: 'objectId' }`) after M8.3 `V004` dedup |
| `restaurants` | None (`slug` is non-unique `index: true`) | Multiple crawler/manual inserts with identical `(tenQuan, diaChi)` or duplicate `slug`/`urlGoc` (`AI M7.1` confirmed duplicate rows exist and added runtime dedup!) | Enforce unique sparse `{ slug: 1 }` & `{ urlGoc: 1 }` after staging dedup |
| `users.savedRestaurants[]` | None | Code uses array `.some(...)` check + `user.save()` (`favorites.service.ts:50-64`); concurrent rapid double-taps read-modify-write can push duplicate `ObjectId`s | Replace read-modify-save with atomic `$addToSet` / `$pull` |
| `itineraries` | None (`shareToken` unindexed) | `shareToken` collisions unguarded if enabled without unique sparse index | Add sparse unique `{ shareToken: 1 }` (`V001`) |

---

## 5. Cross-Service Consistency Assessment (M8.6.5)

Verified across `core-service`, `planning-service`, and `KLTN-123-GastroWise-AI`:
1. **Core `gastro_core.restaurants` $\rightarrow$ AI Service RAM Cache (Static Snapshot Sync):**
   - *Mechanism:* AI loads `restaurants` once at startup (`main.py` lifespan $\rightarrow$ `load_dataset_from_mongo()`). **There is NO event-driven cache invalidation (`Redis Pub/Sub` or Change Streams) implemented.**
   - *Impact:* New restaurants, edits, deletions, or `ReviewsService` rating updates in Core do NOT reach AI's in-memory `df` / `TfidfVectorizer` until AI restarts. (Core compensates partially by hydrating returned IDs fresh from MongoDB in `RestaurantsService`.)
2. **Core `user_interactions` $\rightarrow$ AI SVD Model (`/cf/train`):**
   - Manual/explicit sync via `RestaurantsService.syncInteractionsToAi()` (`restaurants.service.ts:641-664`, max `5000` rows). Until triggered, AI SVD factors are stale; `Interaction.eventType` (`review_submit`, `itinerary_add`) only partially maps to AI `EVENT_WEIGHTS`.
3. **Core (`restaurants` / `users`) $\rightarrow$ Planning (`itineraries`):**
   - Decoupled via ADR-09 synchronous HTTP (`CoreApiClient`) during generation/recalculation, persisting immutable point-in-time `stops[]` snapshots inside `gastro_planning.itineraries`. Partial failure during post-completion telemetry (`updateStatus` calling `recordInteraction` / `applyFeedback`) is non-blocking (`try/catch` warning).
4. **Core Review Write Path Partial Failure:**
   - `ReviewsService.create` executes 4 sequential un-transacted steps (`reviews.service.ts:138-243`): save review $\rightarrow$ aggregate & update `restaurants.diemTrungBinh` $\rightarrow$ `recordEvent` interaction $\rightarrow$ `applyFeedbackEma` Taste DNA. Failure in step 2 leaves `restaurants.diemTrungBinh` stale without rollback.

---

## 6. Severity Classification (Confirmed Defects vs. Potential Risks — M8.6.7)

| Severity | Finding | Classification | Code Evidence | Impact & Mitigation |
|---|---|---|---|---|
| **CRITICAL** | `User.hashedRefreshToken` missing `@Prop()` + plaintext/bcrypt mismatch | **Confirmed Defect** | `user.schema.ts:49`, `auth.service.ts:43,108`, `users.service.ts:113` | Breaks refresh token rotation & logout invalidation. Fix `@Prop()` + hash before persist. |
| **CRITICAL** | `CreateReviewDto` allows `diemReview` up to `10` while overwriting `diemTrungBinh` with `reviewsCount > 0` | **Confirmed Defect** | `create-review.dto.ts:22-24`, `reviews.service.ts:168-174` | Corrupts 5-star invariant assumed by AI M7.1 normalizer. Change DTO `@Max(5)` + schema `min:1, max:5`. |
| **CRITICAL** | `User.resetOtp` lacks server-side expiration (`resetOtpExpiresAt`) | **Confirmed Defect** | `user.schema.ts:90-91`, `auth.service.ts:278,316,365` | OTP never expires; logged in plaintext. Add `resetOtpExpiresAt` + redact logs. |
| **HIGH** | `CreateUserDto` stacks `@IsUrl()` on `firstName` instead of `picture` | **Confirmed Defect** | `create-user.dto.ts:27-33` | Rejects valid `firstName` on DTO validation while leaving `picture` unvalidated. Fix decorator placement. |
| **HIGH** | `CreateRestaurantDto` empty `{}` + global `whitelist: false` + no `runValidators: true` on `findByIdAndUpdate` | **Confirmed Defect** | `create-restaurant.dto.ts:1`, `core/main.ts:20`, `planning/main.ts:29` | Arbitrary/unvalidated payloads accepted on create & update. Define typed DTOs, enable `whitelist: true`, pass `runValidators: true`. |
| **HIGH** | Orphaned children & dangling refs on `RestaurantsService.remove` & `UsersService.remove` | **Confirmed Risk** | `restaurants.service.ts:1079-1084`, `users.service.ts:91-100` | Dangling `menu_items`, `reviews`, `savedRestaurants[]`, `taste_dna_profiles`. Implement cascade/soft-delete. |
| **HIGH** | Unregistered `UserInteraction` schema collision on `user_interactions` + legacy `src/` drift | **Confirmed Defect** | `user-interaction.schema.ts:6` vs `interaction.schema.ts:27` | Incompatible field requirements if mistakenly imported. Remove `user-interaction.schema.ts` & `src/`. |
| **HIGH** | Case-sensitive duplicate email/username & Google `username` collision | **Confirmed Defect** | `users.service.ts:102`, `auth.service.ts:196` | Duplicate accounts / Google `E11000` signup crash. Normalize lowercase + handle conflicts. |
| **MEDIUM** | Concurrent `toggleFavorite` array duplicate race condition | **Confirmed Risk** | `favorites.service.ts:50-64` | Duplicate restaurant IDs in `savedRestaurants[]`. Switch to atomic `$addToSet`/`$pull`. |
| **MEDIUM** | Stale AI in-memory catalog (`no event sync`) & missing MongoDB `$jsonSchema` validators | **Confirmed Risk** | `AI/app/db/mongo.py:40-107`, `BE` schemas | AI recommends deleted/unupdated venues until restart. Add periodic/webhook refresh & DB-level `$jsonSchema` in staging. |
| **LOW** | `ContactsService.updateStatus` unvalidated string status; `UpdateTasteDnaDto.budgetPreference` no `@IsEnum` | **Confirmed Risk** | `contacts.service.ts:232`, `update-taste-dna.dto.ts:63-65` | Arbitrary status strings can be stored via `findByIdAndUpdate`. Add enum DTO validators. |
