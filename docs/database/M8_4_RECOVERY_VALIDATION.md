# M8.4 — MongoDB Recovery Validation Checklist

- **Purpose:** Mandatory verification gate before declaring any backup valid or restoring traffic after a database recovery drill or real incident.
- **Execution Status in M8.4:** **PLANNED CHECKLIST ONLY — NOT EXECUTED IN THIS MILESTONE** *(no live `mongodump`/`mongorestore` or database tests were run during M8.4 planning).*

---

## Phase A — Backup File Integrity (Before Restore)

- [ ] **Checksum Match:** Verify archive `sha256sum` matches recorded manifest checksum (`0` byte corruption).
- [ ] **Archive Readability:** Verify compression integrity (`gzip -t <archive>.archive.gz` exits `0`).
- [ ] **Metadata Inspection (`--dryRun`):** Execute `mongorestore --dryRun --archive=<archive>.archive.gz --gzip` against isolated `mongo:7.0` to confirm BSON stream decodes cleanly and list expected namespaces.

---

## Phase B — Database Accessibility & Basic Structure (After Restore to Target / Staging)

- [ ] **Connectivity & Auth:** Confirm Core Service user (`readWrite` on `gastro_core`), Planning Service user (`readWrite` on `gastro_planning`), and AI Service user (**`read` only** on `gastro_core.restaurants` or synced AI DB) authenticate cleanly over TLS without exposing credentials in logs.
- [ ] **Collection Completeness:** Verify all expected collections exist:
  - `gastro_core`: `users`, `restaurants`, `menu_items`, `reviews`, `contacts`, `user_interactions`, `taste_dna_profiles` (+ `schema_migrations` once M8.3+ active).
  - `gastro_planning`: `itineraries` (+ `schema_migrations` once M8.3+ active).

---

## Phase C — Collection Counts & Index Consistency

- [ ] **Document Count Parity:** Compare restored `collection.countDocuments()` against pre-backup manifest counts (exact match for full/point-in-time snapshot; documented delta for selective/dedup recovery).
- [ ] **Index Parity Check (`collection.getIndexes()`):**
  - `restaurants`: `_id_`, `location_2dsphere` (`2dsphere`), `{ status: 1, diemTrungBinh: -1 }`, text index `{ tenQuan: 'text', tags: 'text' }`, `slug` (plus M8.2+ indexes once applied).
  - `users`: unique indexes on `username` and `email`.
  - `taste_dna_profiles`: unique index on `userId`.
  - `reviews`: `{ restaurantId: 1, createdAt: -1 }`, `{ restaurantId: 1, status: 1, createdAt: -1 }`, `urlGoc`.
  - `itineraries`: `{ user_id: 1, createdAt: -1 }` / `{ user_id: 1, created_at: -1 }`.
- [ ] **Query Plan Sanity (`explain("executionStats")`):** Confirm `$geoNear` on `restaurants` uses `2dsphere` index and user email lookup uses `IXSCAN` on `email_1`.

---

## Phase D — Referential & Data Integrity Checks

- [ ] **Sample Document Validation:** Sample critical collections (`users`, `restaurants`, `reviews`, `itineraries`) and verify UTF-8 Vietnamese text integrity (`tenQuan`, `noiDung`, `diaChi`) and valid timestamps.
- [ ] **Orphan Audit Queries (Read-Only):**
  - Verify `reviews.restaurantId` references resolving in `restaurants` (expect 0 broken refs, or exact pre-incident baseline).
  - Verify `menu_items.restaurantId` references resolving in `restaurants`.
  - Verify `taste_dna_profiles.userId` uniqueness & 6-D vector bounds `[0.0, 1.0]`.
- [ ] **Migration Version Consistency:** Confirm `schema_migrations` matches the deployed application version (e.g., do not run V2 code against a pre-V2 restored DB without re-running forward migration or rolling back app version).

---

## Phase E — Application Compatibility & Critical API Smoke Tests

Execute against restored isolated environment (Nginx `:8080`, Core `:3001`, Planning `:3003`, AI `:5000`):

- [ ] **AI Service Reload & Auth:** AI boots and logs `Load thành công N quán ăn` (`GET /` returns `restaurants_loaded > 0`); fail-closed `X-Internal-AI-Key` enforced (`401`/`403`).
- [ ] **Core Catalog & Geo Search:** `GET /api/v1/restaurants` and `GET /api/v1/restaurants/nearby?lat=10.7769&lon=106.7009` return valid hydrated venues.
- [ ] **Auth & User Profile:** Test login/profile retrieval succeeds (`users` password hashes and roles intact).
- [ ] **Hybrid AI Recommendation:** `POST` Core personalized recommendation hits AI `/recommend/hybrid` and hydrates restaurant docs from restored `gastro_core.restaurants`.
- [ ] **Planning Itinerary Read & Route Generation:** `GET /api/v1/itineraries` reads restored itineraries + embedded `stops[]` snapshots cleanly; new itinerary creation succeeds via Planning ↔ AI `/routes/optimize`.

---

## Phase F — Recovery Timing & Sign-Off Metrics

Record actual timings during every drill to validate proposed RPO/RTO targets:

| Metric | Target Benchmark | Measured Value (Fill During Drill) | Status |
|---|---|---|---|
| Backup Download / Decrypt Duration (`T_fetch`) | `< 5 min` | *Not yet executed* | PENDING |
| `mongorestore` Execution Duration (`T_restore`) | `< 15 min` | *Not yet executed* | PENDING |
| Index Verification & AI Reload (`T_verify`) | `< 10 min` | *Not yet executed* | PENDING |
| **Total Measured RTO (`T_fetch + T_restore + T_verify`)** | **`<= 30 min` (Tier 1)** | *Not yet executed* | PENDING |
