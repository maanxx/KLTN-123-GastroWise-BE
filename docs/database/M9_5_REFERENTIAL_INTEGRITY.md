# M9.5 — Referential Integrity, Uniqueness & Model Collision Remediation (`BLK-07`)

**Milestone:** M9.5 (`P1.2` from [`M8_8_REMEDIATION_ROADMAP.md`](./M8_8_REMEDIATION_ROADMAP.md))  
**Blocker Addressed:** `BLK-07`

---

## 1. Email Normalization & User Uniqueness

- Created [`normalizeEmail`](../../libs/shared/src/utils/email.util.ts) (`trim().toLowerCase()`) and `escapeRegexLiteral`.
- Updated [`User`](../../apps/core-service/src/users/schemas/user.schema.ts): added `lowercase: true, trim: true` on `email`, `trim: true` on `username`, and normalized both inside `UserSchema.pre('save')`.
- Updated [`UsersService`](../../apps/core-service/src/users/users.service.ts):
  - Normalizes emails on `create()` and `findOneByEmail()`.
  - Queries exact `{ email: normalizedEmail }` first (`IXSCAN` on unique index `email_1`), with an anchored case-insensitive fallback strictly when querying pre-V004 mixed-case strings.
  - Translates MongoDB `11000` errors into `ConflictException` (`Email already exists` / `Username already exists`).
- Updated [`AuthService`](../../apps/core-service/src/auth/auth.service.ts) and [`GoogleStrategy`](../../apps/core-service/src/auth/google.strategy.ts) to apply consistent email normalization across `register()`, `login()`, `forgotPassword()`, `resetPassword()`, and `signInWithGoogle()`.

---

## 2. Google OAuth Signup Collision Prevention

Replaced unsafe `username: googleUser.email.split('@')[0]` + weak `Math.random()` secret in [`AuthService._findOrCreateGoogleUser`](../../apps/core-service/src/auth/auth.service.ts):
1. Normalizes `googleUser.email` first and links existing accounts cleanly without overwriting `password`, `username`, or `role`.
2. Uses CSPRNG `randomBytes(32).toString('hex')` for OAuth-provisioned passwords.
3. On concurrent email signup race (`E11000` on `email`), catches conflict and returns the winning account cleanly.
4. On cross-domain `username` collision (e.g., `alice@gmail.com` vs `alice@yahoo.com`), retries up to 5 attempts appending `_<6-hex>` suffix.

---

## 3. Atomic Favorite Operations

Replaced read-modify-write `user.save()` in [`FavoritesService.toggleFavorite`](../../apps/core-service/src/favorites/favorites.service.ts) with atomic single-document MongoDB operators:
1. Conditionally removes via `findOneAndUpdate({ _id: userObjId, savedRestaurants: resId }, { $pull: { savedRestaurants: resId } }, { new: true })`.
2. If not removed, atomically adds via `findOneAndUpdate({ _id: userObjId }, { $addToSet: { savedRestaurants: resId } }, { new: true })`, returning `NotFoundException('User not found')` if user is absent.
- Preserves existing response payload (`{ message, isFavorite }`) while eliminating duplicate entries and lost-update races under concurrent requests.

---

## 4. Deletion Semantics & Referential Integrity Matrix

| Parent Entity & Operation | Dependent Entity / Relationship | Applied Strategy | Target Implementation |
| :--- | :--- | :--- | :--- |
| **`Restaurant` deleted** (`RestaurantsService.remove`) | `menu_items` (`restaurantId`) | **Cascade Delete** (child-owned records) | `menuItemModel.deleteMany({ restaurantId })` |
| **`Restaurant` deleted** | `reviews` (`restaurantId`) | **Cascade Delete** | `reviewModel.deleteMany({ restaurantId })` |
| **`Restaurant` deleted** | `users.savedRestaurants[]`, `favorite_collections.restaurantIds[]` | **Pull Reference** | `$pull: { savedRestaurants / restaurantIds }` |
| **`Restaurant` deleted** | `user_interactions`, Planning `itineraries.stops[]` | **Preserve Immutable Snapshot / Event History** | ADR-09 scalar snapshots & telemetry preserved |
| **`User` deleted** (`UsersService.remove`) | `taste_dna_profiles`, `favorite_collections`, `notifications`, `chat_sessions` | **Cascade Delete** (private user-owned entities) | `deleteMany({ userId })` |
| **`User` deleted** | `reviews` (`userId`) | **Anonymize & Unlink** (preserve community rating integrity) | `$set: { userId: null, userName: 'Deleted User' }` |
| **`User` deleted** | `restaurants` (`ownerId`) | **Unlink Ownership** (preserve venue catalog) | `$set: { ownerId: null }` |
| **`MenuItem` created** (`RestaurantsService.createMenuItem`) | `restaurants` (`restaurantId` or `slug`) | **Parent Existence Check** | Throws `NotFoundException` if restaurant missing |
| **`Review` created / deleted** (`ReviewsService`) | `(userId, restaurantId)` uniqueness & restaurant `diemTrungBinh` / `reviewsCount` | **Duplicate Prevention + Stats Sync** | `ConflictException` pre-check + `uniq_user_restaurant_review` partial unique index; `_recalculateRestaurantStats` on create & delete |

---

## 5. `UserInteraction` Model Collision Investigation & Cleanup

- **Authoritative Implementation:** [`Interaction`](../../apps/core-service/src/interactions/schemas/interaction.schema.ts) (`collection: 'user_interactions'`), imported and registered by `InteractionsModule`, `InternalInteractionsController`, and `data-integrity.spec.ts`.
- **Obsolete Colliding Files Removed:**
  - `apps/core-service/src/users/schemas/user-interaction.schema.ts` — verified `0` imports across `apps/`, `libs/`, and `test/`; removed.
  - `src/users/schemas/user-interaction.schema.ts` — verified `0` imports across `src/` and `test/`; removed.
- **Root `src/` Legacy Monolith Retention Note:** Static verification confirmed `test/app.e2e-spec.ts:5` still imports `../src/app.module` (and `package.json` `format`/`lint` globs include `src/`). Per M9.5 safety rules, only the unreferenced colliding `user-interaction.schema.ts` files were removed; deleting the entire root `src/` tree should be paired with updating `test/app.e2e-spec.ts` cleanly in a dedicated cleanup task.

---

## 6. Versioned Migration Support (`V004`)

Created [`v004_referential_hygiene_and_uniqueness.migration.ts`](../../scripts/migrations/core/v004_referential_hygiene_and_uniqueness.migration.ts) registered in [`migrations.registry.ts`](../../scripts/migrations/migrations.registry.ts):
1. Detects case-variant duplicate emails in `users` before mutating records (prevents blind `E11000` errors on normalization).
2. Normalizes emails (`trim().toLowerCase()`) and strips dangling `savedRestaurants` IDs in bounded batches (`500`).
3. Deduplicates `(userId, restaurantId)` reviews (keeping latest), archives deleted duplicates into `_archive_reviews_duplicates`, and archives orphan `menu_items` into `_archive_orphan_refs`.
4. Creates partial unique index `uniq_user_restaurant_review` (`partialFilterExpression: { userId: { $type: 'objectId' } }`, `background: true`), with full `down()` restoration support.
