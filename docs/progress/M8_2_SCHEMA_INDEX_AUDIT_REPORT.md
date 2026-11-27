# M8.2 — MongoDB Schema & Index Audit Report

- **Repository:** `maanxx/KLTN-123-GastroWise-BE`
- **Branch:** `feature/m8-2-schema-index-audit` (based on M8.1 commit `057eb643463f9eeb7f898003a86c39d838ea20bd`)
- **Full Technical Reference:** [`docs/database/M8_2_SCHEMA_INDEX_AUDIT.md`](../database/M8_2_SCHEMA_INDEX_AUDIT.md)
- **Final Verdict:** **`CONDITIONAL PASS`** *(complete static read-only audit across all Core, Planning, and legacy schemas, models, indexes, and queries; live MongoDB Atlas `explain()` plans and collection statistics were not executed in this read-only offline milestone)*

---

## 1. Audit Scope & Verification Summary

- **Static Source-Code Verification Performed:**
  - Verified all `@Schema()` decorators (`28` total: `9` active runtime schemas in `apps/`, `5` unregistered schemas in `apps/`, `14` legacy duplicates in `src/`).
  - Verified `8` active runtime collections (`7` Core Service, `1` Planning Service; `restaurants` shared read-only with AI Service).
  - Inventoried `29` indexes (`8` automatic `_id` + `21` custom declarations, `0` TTL indexes).
  - Cross-referenced every `find`, `findOne`, `aggregate`, `.populate()`, `$lookup`, and `.sort()` call in `apps/` against declared indexes.
- **Automated Test Execution:** None modified or re-run in this documentation-only milestone (`git status` confirmed zero TypeScript/schema edits).
- **Live MongoDB Evidence:** Not executed (per M8.2 strict read-only rule avoiding production DB inspection/mutation).

---

## 2. Highlighted Findings Summary

| Severity | Finding | Evidence Location | Impact |
|---|---|---|---|
| **P0** | `User.hashedRefreshToken` missing `@Prop()` + plaintext vs. bcrypt mismatch | `user.schema.ts:49`, `auth.service.ts:43,83,108`, `users.service.ts:113` | Refresh token persistence silently discarded |
| **P0** | `User.resetOtp` missing expiry timestamp + plaintext OTP log | `user.schema.ts:90-91`, `auth.service.ts:278,316,365` | Password-reset OTPs never expire |
| **P0** | Collection collision on `user_interactions` + legacy `src/` divergence | `interaction.schema.ts:27`, `user-interaction.schema.ts:6`, `src/itineraries/schemas/itinerary.schema.ts:11,54` | Risk of incompatible schema writes |
| **P0** | Mixed rating scales (`0–10` vs `0–5`) in `restaurants.diemTrungBinh` | `restaurant.schema.ts:12`, `reviews.service.ts:168`, `restaurants.service.ts:822-855` | Filtering/ranking scale inconsistency |
| **P1** | Missing sort/filter indexes (`menu_items`, `reviews.isFeatured`, `restaurants`, `contacts`) | `menu-item.schema.ts`, `review.schema.ts:63-64`, `restaurants.service.ts:614`, `contact.schema.ts` | Potential `COLLSCAN` & blocking `SORT` |
| **P1** | Startup full-collection `COLLSCAN` & Q1 default coordinates trap | `restaurants.service.ts:51-118`, `restaurant.schema.ts:29-31` | Slow cold boots & false geo matches |
| **P1** | Unbounded `$unwind`/`$lookup` favorites & `UsersService.findAll` `'merchant'`/`'owner'` bug | `favorites.service.ts:75-100`, `users.service.ts:32-33` vs `user.schema.ts:69` | Expensive agg scan; `'owner'` search broken |
| **P2** | Redundant indexes & dual timestamps on `itineraries`, `user_interactions`, `taste_dna_profiles` | `itinerary.schema.ts:63,127,152-153`, `interaction.schema.ts:29,45`, `taste-dna.schema.ts:13-14` | Write amplification & index memory waste |
| **P2** | Zero TTL policies on `user_interactions` + unused `restaurants.cityId` index | `interaction.schema.ts:27`, `restaurant.schema.ts:10-11` | Unbounded telemetry collection growth |
| **P3** | `4` unused Core schemas (`chat_sessions`, `favoritecollections`, `auditlogs`, `notifications`) | `apps/core-service/src/**/schemas/` | Dead code / schema clutter |

---

## 3. Recommended Next Steps (M8.3 Remediation Roadmap)

1. **M8.3.1 (P0 Auth/User Fixes + Migration Tooling):** Add `@Prop()` to `User.hashedRefreshToken` (hash before store), add `resetOtpExpiresAt`, introduce versioned migration runner (`schema_migrations`), and remove `ensureGeoJsonLocations` boot scan.
2. **M8.3.2 (P1 Indexes & Staging `explain()`):** Build missing background indexes in isolated `mongo:7.0` + staging Atlas replica and verify `IXSCAN` via `explain('executionStats')`.
3. **M8.3.3 (P0/P2 Scale & Index Cleanup):** Backfill `restaurants.ratingScale` (`rawRating`), consolidate `itineraries` timestamps, remove redundant single-field indexes, and archive `src/` + colliding/orphaned schemas.
