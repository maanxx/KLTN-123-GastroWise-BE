# GASTROWISE — NEXT TASKS & VERIFICATION ROADMAP

**Branch:** `feature/m9-6-backup-pipeline-readiness-probes`
**Current Phase Completed:** M9.7.0 — Full Backend Integration & Release Readiness Audit (Code complete through M9.6.1; local build/typecheck/Jest/shellcheck verified)
**Next Phase:** M9.7.2 — Migration CLI Production Guard & Service Lint Cleanup, followed by Staging Snapshot Audit (`BLK-11`) & PR Integration

---

## 1. COMPLETED MILESTONES (CODE & LOCAL VERIFICATION)
- [x] **Milestone 1 – 2.3.1:** Removed insecure default secrets, hardened mutual auth (`InternalAuthGuard`, `AiApiClient`, `CoreApiClient`), enforced JWT validation, IDOR protection (`SafeUserResponseDto`), Contacts RBAC, Nginx CORS allowlist, and AI contract alignment.
- [x] **M8.1 – M8.8 (Database Audit Phase):** Completed architecture, schema/index, migration strategy, backup/DR, data integrity, runtime validation, and blocker register (`docs/database/`).
- [x] **M9.1 (`BLK-08`):** Implemented versioned TypeScript MongoDB migration runner (`libs/shared/src/migrations/`, `scripts/migrations/`).
- [x] **M9.2 (`BLK-01`, `BLK-02`):** Remediated `User.hashedRefreshToken` bcrypt hashing/validation and `resetOtpExpiresAt` expiration enforcement.
- [x] **M9.3 (`BLK-03`, `BLK-05`):** Aligned DTOs (`CreateReviewDto` `@Max(5)`, `CreateRestaurantDto`, `CreateUserDto`), Mongoose schemas, and `ValidationPipe({ whitelist: true, transform: true })`.
- [x] **M9.4 (`BLK-06`, `BLK-09`):** Configured Docker `mongo-test` (`mongo:7.0`) `--auth` with least-privilege SCRAM users (`docker/mongo/01-init-users.js`) and AI DB config parity. *(Note: `KLTN-123-GastroWise-AI` M9.4 patch remains unpushed pending repo authorization.)*
- [x] **M9.5 (`BLK-04`, `BLK-07`):** Removed District 1 GeoJSON fallback default, removed startup `ensureGeoJsonLocations` scan, added email normalization, atomic favorites, cascade deletes, `V003` & `V004` migrations.
- [x] **M9.6 & M9.6.1 (`BLK-10` code):** Implemented `GET /health/ready` readiness probes (`core-service`, `planning-service`), encrypted S3 backup/restore scripts (`scripts/backup/`), and GitHub Actions workflows (`.github/workflows/`), hardened with mandatory `.sha256` sidecar verification and fail-closed `atlas-tier-audit.sh`.
- [x] **M9.7.0:** Executed full backend integration & release readiness audit (`npm run build:all` PASS, `tsc --noEmit` PASS, `30/30` Jest suites / `185/185` tests PASS, `shellcheck` PASS).

---

## 2. PENDING TASKS & REMAINING BLOCKERS
- [ ] **M9.7.2 (Next Implementation Task — P1/P2):** Add fail-closed `mongodb+srv://` / `mongodb.net` Atlas guard to `scripts/migrations/cli.ts` (`F-M2`) and clean up empty `catch {}` blocks in `apps/core-service/src/restaurants/restaurants.service.ts` (`L-01`).
- [ ] **BLK-11 (HIGH — Unresolved):** Provision an authorized isolated staging Atlas snapshot and execute `docs/database/M9_5_STAGING_AUDIT_PLAN.md` + `docs/database/M8_3_STAGING_READINESS_CHECKLIST.md`.
- [ ] **BLK-10a/b/c (Infra — Unverified):** Configure GitHub Actions secrets (`production-backup`, `backup-verification`), run `scripts/backup/atlas-tier-audit.sh` with Atlas Admin keys, and verify S3 bucket Object Lock configuration.
- [ ] **External — `KLTN-123-GastroWise-AI`:** Apply/push M9.4 DB parity patch, `ISSUE-06` (10→5 rating scale normalization), and `ISSUE-11` (`cv2` NLU coupling).
- [ ] **External — `KLTN-123-GastroWise-Mobile`:** Resolve `ISSUE-10` (point `EXPO_PUBLIC_API_URL` to API Gateway port `8080`).
- [ ] **Atlas DBA (`ISSUE-12`):** Revoke/delete legacy historical database user `thienthien` on MongoDB Atlas console.
- [ ] **PR Integration:** Open and review PR from `feature/m9-6-backup-pipeline-readiness-probes` → `main`.
