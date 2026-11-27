# M8.8 — Database Production Readiness Remediation Roadmap

- **Repository:** `maanxx/KLTN-123-GastroWise-BE`
- **Branch:** `feature/m8-8-database-final-review`
- **Scope:** Sequenced remediation plan for Milestone M9+ (do NOT deploy to production until `P0` and `P1` gates pass).

---

## Priority Overview & Dependency Graph

```text
[P0.1 Security & Auth Fixes (BLK-01, BLK-02)] ──┐
[P0.2 DTO & Schema Integrity Fixes (BLK-03,05)]┼──▶ [P1.1 Versioned Migration Runner V001-V006 (BLK-08)]
[P0.3 Docker --auth & AI DB Parity (BLK-06,09)] ┘            │
                                                             ▼
[P1.2 Staging Atlas Clone Dry-Run & Dedup (BLK-04,07,11)] ──▶ [P1.3 Production Cutover & Backup Gate (BLK-10,13)]
                                                                         │
                                                                         ▼
                                                             [P2 Hardening & DR Drills (BLK-12)] ──▶ [P3 Future]
```

---

## P0 — Must Fix Before Any Staging Sign-Off or Production Prep

1. **P0.1 — Fix `User` Auth & Security Schema Defects (`BLK-01`, `BLK-02`)**
   - *Actions:* Add `@Prop({ required: false })` to `User.hashedRefreshToken`; hash refresh token in `AuthService` via `_hashData()` before `UsersService.updateRefreshToken()`; add `resetOtpExpiresAt: Date` + expiry check (`15m`) in `resetPassword()`; strip raw OTPs from `console.log`.
   - *Acceptance Criteria:* Live `register` $\rightarrow$ `login` $\rightarrow$ `refresh` (`200`) $\rightarrow$ `logout` $\rightarrow$ `refresh` (`403`) E2E passes; expired OTP fails `400`.
2. **P0.2 — Fix Broken DTO Validators & Enable Strict Validation (`BLK-03`, `BLK-05`)**
   - *Actions:* Change `CreateReviewDto.diemReview` `@Max(10)` $\rightarrow$ `@Max(5)` and add `min: 1, max: 5` on `Review.diemReview`; move `@IsUrl()` from `CreateUserDto.firstName` to `picture`; implement typed `CreateRestaurantDto` & `MenuItemDto`; set `ValidationPipe({ whitelist: true, transform: true })` in both services; add `runValidators: true` on `findByIdAndUpdate` calls.
   - *Acceptance Criteria:* `POST /api/v1/reviews` rejects `diemReview: 6` (`400`); `POST /api/v1/restaurants` validates required fields & string `tags`; Jest integrity tests updated and passing.
3. **P0.3 — Fix Docker Staging `--auth` & AI DB Parity (`BLK-06`, `BLK-09`)**
   - *Actions:* Enable `--auth` in `docker-compose.yml` `mongo:7.0` with per-service SCRAM users (`core` RW `gastro_core_test`, `planning` RW `gastro_planning_test`, `ai` read-only `gastro_core_test.restaurants`); align AI Compose env `MONGODB_DB_NAME=gastro_core_test`.
   - *Acceptance Criteria:* `ai-service` `GET /` logs `restaurants_loaded > 0`; AI fails write attempts (`Unauthorized`); Core fails access to `gastro_planning_test`.

---

## P1 — Must Fix Before Production Rollout

4. **P1.1 — Implement Versioned TypeScript Migration Runner (`BLK-08`)**
   - *Dependencies:* `P0.1`, `P0.2`.
   - *Actions:* Build CLI runner in `scripts/migrations/` tracking `schema_migrations { _id, checksum, appliedAt, durationMs, status }` with `--dry-run`, `--up`, `--down`, batching (`500`), and lock checks implementing `V001`–`V006`. Replace `RestaurantsService.ensureGeoJsonLocations()` startup scan with `V003`.
   - *Acceptance Criteria:* `V001`–`V006` execute idempotently twice (`0` delta on Run #2) and pass `--down` / archive rollback verification in authenticated Docker `mongo:7.0`.
5. **P1.2 — Resolve Referential Integrity, Uniqueness & GeoJSON Fallback (`BLK-04`, `BLK-07`, `BLK-11`)**
   - *Dependencies:* `P0.2`, `P1.1`.
   - *Actions:* Remove `[106.7009, 10.7769]` GeoJSON default on `Restaurant.location`; normalize `email` lowercase (`UsersService`) & disambiguate Google `username`; convert `toggleFavorite` to atomic `$addToSet`/`$pull`; add cascade/soft-delete in `RestaurantsService.remove` & `UsersService.remove`; delete colliding `user-interaction.schema.ts` and root `src/` monolith copy; clone production snapshot to isolated staging and run `V001`–`V006` dry-run + `$jsonSchema` `collMod` validation.
   - *Acceptance Criteria:* Staging `explain("executionStats")` confirms `IXSCAN` on all hot queries; `0` orphan/duplicate errors; `POST /itineraries/generate` returns `0` Gulf-of-Guinea distance anomalies.
6. **P1.3 — Establish Production Backup Pipeline & Readiness Probes (`BLK-10`, `BLK-13`)**
   - *Dependencies:* `P1.2`.
   - *Actions:* Verify MongoDB Atlas cluster tier (upgrade to M10+ for Cloud PITR if on Shared M0/M2/M5); automate scheduled encrypted `mongodump --archive --gzip` to WORM-locked S3/GCS/R2 bucket with automated weekly `mongo:7.0` restore test; add `/health/ready` checking `mongoose.connection.readyState === 1`; complete [`M8_3_STAGING_READINESS_CHECKLIST.md`](./M8_3_STAGING_READINESS_CHECKLIST.md) & [`M8_4_RECOVERY_VALIDATION.md`](./M8_4_RECOVERY_VALIDATION.md).
   - *Acceptance Criteria:* Pre-migration snapshot verified (`sha256` + test restore); `/health/ready` fails `503` when DB disconnects.

---

## P2 — Recommended Hardening (Post-Cutover Stabilization)

7. **P2.1 — Event-Driven AI Catalog Refresh & Interaction Alignment:** Expose authenticated internal reload endpoint or Redis Pub/Sub / MongoDB Change Stream listener so AI `df` refreshes without container restarts, and unify `InteractionEventType` keys with AI `EVENT_WEIGHTS`.
8. **P2.2 — Execute DR Exercises 1 & 2 (`BLK-12`):** Run `mongo-test` stop/start outage and `ai-service` outage exercises in staging Compose, verify Nginx failover, correlation IDs, and measured RTO benchmarks.
9. **P2.3 — TTL Retention Policy on Telemetry:** Evaluate and apply selective MongoDB TTL index on transient `view`/`search` rows in `user_interactions` (`>= 180d`) after confirming AI CF training window needs.

---

## P3 — Future Improvements

10. **P3.1 — Multi-Document ACID Transactions:** Wrap `ReviewsService.create` multi-collection aggregate updates (`reviews` + `restaurants.diemTrungBinh` + `taste_dna_profiles`) in Mongoose ClientSessions once MongoDB Atlas Replica Set (`M10+`) is confirmed.
11. **P3.2 — Read Replicas & Observability:** Route heavy analytics aggregations (`getMatrixExport`, admin dashboards) to Secondary readPreference and export Atlas/Prometheus DB latency & connection-pool dashboards.
