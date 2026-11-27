# M8.6 — Automated Data Integrity Testing Strategy

- **Repository:** `maanxx/KLTN-123-GastroWise-BE`
- **Implemented Test Suite:** [`libs/shared/src/contracts/data-integrity.spec.ts`](../../libs/shared/src/contracts/data-integrity.spec.ts) (isolated in-memory Jest tests — zero MongoDB connection or production data required).

---

## 1. Testing Tiers

| Tier | Infrastructure Required | What It Verifies | Status in M8.6 |
|---|---|---|---|
| **Tier 1: In-Memory Schema & DTO Fixture Tests** | Jest + Mongoose `SchemaFactory` + `class-validator` (`validateSync`, `new Model().validateSync()`) | Required fields, enum constraints, numeric `[0,1]` / `[1,5]` bounds, missing `@Prop()` metadata behavior, nested `ItineraryStop` validation, DTO defect regression guards | **Implemented & Executed** (`data-integrity.spec.ts`) |
| **Tier 2: Isolated Ephemeral MongoDB Tests (`mongo:7.0`)** | Local Docker `mongo-test` container (`M8.3` / `M8.4`) | Real MongoDB `E11000` unique index enforcement, `findByIdAndUpdate` with/without `runValidators`, partial unique index on `reviews`, atomic `$addToSet`/`$pull`, `$lookup` orphan queries | **Planned Specification (Section 2)** — Deferred until M8 staging/Docker execution |
| **Tier 3: Staging Read-Only Audit Queries** | Isolated staging snapshot (`M8_3_STAGING_READINESS_CHECKLIST.md`) | Counting actual orphan refs, historical duplicate reviews, case-variant duplicate emails, mixed-scale `diemTrungBinh` | **Planned Specification (Section 3)** — Forbidden against production in M8.6 |

---

## 2. Concrete Specification for Ephemeral MongoDB (`mongo:7.0`) Integrity Suite

To be run inside M8 CI Docker workflow against `gastro_core_test` / `gastro_planning_test`:
1. **Uniqueness Race Test:** Fire parallel `Promise.all` `toggleFavorite()` calls for the same `(userId, restaurantId)` → assert `savedRestaurants.length === 1` after atomic `$addToSet` remediation.
2. **Duplicate Review Prevention Test:** Insert two reviews with identical `(userId, restaurantId)` → assert second write fails with `E11000` once partial unique index is deployed.
3. **Referential Orphan & Cascade Test:** Create `Restaurant` + child `MenuItem` + child `Review` + `User.savedRestaurants` entry → delete restaurant → assert orphan count equals `0` after cascade remediation.
4. **Refresh Token Persistence Test:** Run `AuthService.login` → read `User` document from `mongo-test` → assert `hashedRefreshToken` is non-null bcrypt hash after `user.schema.ts` `@Prop()` fix.

---

## 3. Staging Read-Only Anomaly Detection Queries (Non-Destructive)

```javascript
// 1. Orphan MenuItems whose restaurantId does not exist in restaurants
db.menu_items.aggregate([
  { $lookup: { from: "restaurants", localField: "restaurantId", foreignField: "_id", as: "r" } },
  { $match: { "r.0": { $exists: false } } },
  { $count: "orphan_menu_items" }
]);

// 2. Duplicate user reviews on the same restaurant
db.reviews.aggregate([
  { $match: { userId: { $type: "objectId" } } },
  { $group: { _id: { userId: "$userId", restaurantId: "$restaurantId" }, count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } },
  { $count: "duplicate_review_pairs" }
]);

// 3. Case-insensitive duplicate user emails
db.users.aggregate([
  { $group: { _id: { $toLower: "$email" }, count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } }
]);
```
