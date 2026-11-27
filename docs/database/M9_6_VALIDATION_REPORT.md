# M9.6 — Automated & Isolated Runtime Validation Report

**Branch:** `feature/m9-6-backup-pipeline-readiness-probes`  
**Environment:** Local NestJS build/Jest + Isolated Docker Compose (`mongo:7.0` `--auth`)  
**Scope:** Automated verification of `/health/ready` fail-closed outage/recovery and isolated encrypted `mongodump` / `mongorestore` drill (zero production Atlas interaction).

---

## 1. Automated Build, Lint & Unit Tests

| Check | Command | Outcome |
| :--- | :--- | :--- |
| TypeScript builds | `npm run build:shared && npm run build:core && npm run build:planning` | **PASS** (`exit 0`) |
| Strict typecheck | `npx tsc -p tsconfig.build.json --noEmit` | **PASS** (`exit 0`) |
| Docker Compose config | `docker compose config -q` | **PASS** (`exit 0`) |
| ESLint (`libs/shared/src/health/*.ts`, `apps/*/src/health/*.ts`) | `npx eslint ...` | **PASS** (`0 errors, 4 warnings` in test spec mocks) |
| Microservice Jest suite | `npm run test:microservices` | **PASS** — `30 passed, 30 total` suites; `185 passed, 185 total` tests |

---

## 2. Live Docker `/health/ready` Failover & Auto-Recovery Drill

1. **Healthy Steady State:**
   - `GET http://127.0.0.1:3001/health/ready` $\rightarrow$ `200` (`"status":"READY","readyState":1,"dbPingOk":true`)
   - `GET http://127.0.0.1:3003/health/ready` $\rightarrow$ `200` (`"status":"READY","readyState":1,"dbPingOk":true`)
2. **Database Outage (`docker compose stop mongo-test`):**
   - Core `GET /health` liveness remained `200` (process alive).
   - Core `GET /health/ready` returned **HTTP `503`** (`"status":"NOT_READY","readyState":0,"readyStateLabel":"disconnected","dbPingOk":false`).
   - Planning `GET /health/ready` returned **HTTP `503`** (`"status":"NOT_READY","readyState":0,"readyStateLabel":"disconnected","dbPingOk":false`).
3. **Database Recovery (`docker compose start mongo-test`):**
   - Both Core and Planning automatically reconnected and recovered `GET /health/ready` to **HTTP `200 READY`** without container restarts.

---

## 3. Live Isolated Encrypted Backup & Ephemeral Restore Verification

Executed [`scripts/backup/mongo-backup.sh`](../../scripts/backup/mongo-backup.sh) and [`scripts/backup/verify-restore.sh`](../../scripts/backup/verify-restore.sh) inside a `mongo:7.0` container against synthetic database `gastro_m96_backup_src` (`2` GeoJSON restaurants, `2dsphere` index) and restored into `gastro_m96_restore_verify`:
- `mongo-backup.sh` masked credentials (`mongodb://[REDACTED_AUTH]@mongo-test:27017/...`), produced gzip-verified archive (`gzip -t`), encrypted to `.archive.gz.enc` (`AES-256-CBC` PBKDF2), and wrote `.sha256` (`527f68e00618ca89084a481e05a4c3a3d7b22006c10743a7cc456169aff039b7`) and `.manifest.json`.
- `verify-restore.sh` validated the SHA-256 checksum, decrypted `.enc`, passed `gzip -t`, ran `mongorestore` (`2 document(s) restored successfully. 0 document(s) failed to restore.`), and verified `collectionCount: 1, totalDocuments: 2, indexes: ["_id_", "location_2dsphere"]` (`durationSec: 0`, `[verify-restore] PASS`).
- Cleaned up both ephemeral databases and temporary dump directory afterward.

---

## 4. Overall Readiness Gate Assessment

- **In-Repo Technical Readiness:** **PASS** (readiness probes + backup/restore automation + CI workflows verified in isolated Docker).
- **Overall Milestone P1.3 Sign-Off:** **CONDITIONAL / BLOCKED ON EXTERNAL INFRASTRUCTURE (`BLK-11`, Atlas M10+ tier verification, WORM cloud secrets, and `M8_3`/`M8_4` cloud drill execution).**
