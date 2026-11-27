# M9.4 — Docker MongoDB Authentication & AI Database Parity

**Milestone:** M9.4 (`P0.3` from `M8_8_REMEDIATION_ROADMAP.md`)  
**Resolves:** `BLK-09` (Missing Docker `--auth` / SCRAM RBAC) and `BLK-06` (AI Database Parity)  
**Environment Scope:** Isolated Docker staging (`docker-compose.yml` — 100% isolated from MongoDB Atlas / production)

---

## 1. Architecture Summary

Prior to M9.4, the Docker staging MongoDB container (`gastrowise-mongo-test`, `mongo:7.0`) ran without `--auth`, and `ai-service` targeted an empty `gastro_ai_test` database (`restaurants_loaded: 0`). M9.4 hardens the Docker database topology as follows:

1. **Enforced SCRAM Authentication (`--auth`):**
   - `mongo-test` starts with `command: ["mongod", "--auth", "--bind_ip_all"]`.
   - Unauthenticated queries against `admin`, `gastro_core_test`, and `gastro_planning_test` are rejected by MongoDB (`code: 13 Unauthorized`).
2. **Database-per-Service & Least-Privilege Roles:**
   - **Core Service (`CORE_DB_USER` / `gastro_core_svc`)**: `readWrite` scoped strictly to `gastro_core_test` (`authSource=gastro_core_test`).
   - **Planning Service (`PLANNING_DB_USER` / `gastro_planning_svc`)**: `readWrite` scoped strictly to `gastro_planning_test` (`authSource=gastro_planning_test`).
   - **AI Service (`AI_DB_USER` / `gastro_ai_reader`)**: `read` only scoped strictly to `gastro_core_test` (`authSource=gastro_core_test`), sharing Core's catalog database without write capability or access to `gastro_planning_test`.
   - **Root Operator (`MONGODB_ROOT_USERNAME`)**: `root` on `admin`, used only for administrative operations, healthchecks, and bootstrap/recovery.
3. **AI Catalog Parity & Fail-Loud Auth Behavior:**
   - `ai-service` targets `MONGODB_DB_NAME=gastro_core_test` and collection `restaurants` using its dedicated read-only user.
   - `KLTN-123-GastroWise-AI/app/db/mongo.py` (`DatabaseLoadError`) and `main.py` (`503` handler) no longer mask authentication or connectivity errors as empty DataFrames; credentials are masked via `sanitize_log_message` before logging or raising.

---

## 2. Initialization & Persistence Strategy

### 2.1 Fresh Volumes (`/docker-entrypoint-initdb.d`)

- `docker/mongo/01-init-users.js` is mounted read-only at `/docker-entrypoint-initdb.d/01-init-users.js`.
- `mongo-test` mounts named persistent volume `mongo_test_data:/data/db` so SCRAM users and staged collections survive `docker compose restart` and container recreation.
- `01-init-users.js` reads all credentials exclusively from `process.env` (`MONGO_INITDB_ROOT_*`, `CORE_DB_*`, `PLANNING_DB_*`, `AI_DB_*`), validates distinctness between `CORE_DB_USER` and `AI_DB_USER`, and upserts users idempotently via `getUser` + `createUser` / `updateUser`. Zero hardcoded passwords exist in `01-init-users.js`.

### 2.2 Pre-Existing Persistent Volumes

Because MongoDB's entrypoint skips `/docker-entrypoint-initdb.d/*` whenever `/data/db` is non-empty:
- [`docker/mongo/ensure-auth-users.sh`](../../docker/mongo/ensure-auth-users.sh) executes `01-init-users.js` idempotently against a running `mongo-test` container (automatically authenticating as root if `--auth` is already active, or connecting locally before `--auth` is enabled on an existing unauthenticated volume).
- **Pre-M9.4 Volume Transition Record:** Before switching `docker-compose.yml` to the named `mongo_test_data` volume, inspection of the prior anonymous `/data/db` volume confirmed only synthetic M8.7 test fixtures (`gastro_core_test.taste_dna_profiles: 1`, `gastro_planning_test.itineraries: 2`, `0` production records). Switching to `mongo_test_data` triggered clean initialization via `/docker-entrypoint-initdb.d/01-init-users.js`.

### 2.3 Authenticated Healthcheck

`mongo-test`'s Docker healthcheck authenticates with `-u "$$MONGO_INITDB_ROOT_USERNAME" -p "$$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin` and verifies both `db.adminCommand('ping')` and presence of the provisioned `CORE_DB_USER` account before marking `mongo-test` healthy for dependent services (`core-service`, `planning-service`, `ai-service`).

---

## 3. Environment Configuration & URI Safety

| Variable | Target Consumer | Purpose |
| :--- | :--- | :--- |
| `MONGODB_ROOT_USERNAME` / `MONGODB_ROOT_PASSWORD` | `mongo-test` | Admin `root` credentials for initialization and authenticated healthchecks |
| `CORE_DB_NAME_STAGING` / `CORE_DB_NAME` | `mongo-test`, `core-service` | Core logical database (`gastro_core_test` in Docker staging) |
| `CORE_DB_USER` / `CORE_DB_PASSWORD` | `mongo-test`, `core-service` | Least-privilege `readWrite` credential on `gastro_core_test` |
| `PLANNING_DB_NAME_STAGING` / `PLANNING_DB_NAME` | `mongo-test`, `planning-service` | Planning logical database (`gastro_planning_test` in Docker staging) |
| `PLANNING_DB_USER` / `PLANNING_DB_PASSWORD` | `mongo-test`, `planning-service` | Least-privilege `readWrite` credential on `gastro_planning_test` |
| `AI_MONGODB_DB_NAME` / `MONGODB_DB_NAME` | `ai-service` | Aligned to `gastro_core_test` for catalog reads |
| `AI_DB_USER` / `AI_DB_PASSWORD` | `mongo-test`, `ai-service` | Least-privilege `read` credential on `gastro_core_test` |
| `CORE_MONGODB_URI` / `MONGODB_URI_CORE` | `core-service` | Optional explicit URI override |
| `PLANNING_MONGODB_URI` / `MONGODB_URI_PLANNING` | `planning-service` | Optional explicit URI override |
| `AI_MONGODB_URI` / `MONGODB_URI_AI` | `ai-service` | Optional explicit URI override |

- **Percent-Encoding:** `resolveServiceMongoUri()` in [`libs/shared/src/database/mongo-uri.util.ts`](../../libs/shared/src/database/mongo-uri.util.ts) (used by [`apps/core-service/src/app.module.ts`](../../apps/core-service/src/app.module.ts) and [`apps/planning-service/src/app.module.ts`](../../apps/planning-service/src/app.module.ts)) and `build_mongo_uri_from_env()` in `KLTN-123-GastroWise-AI/app/config.py` percent-encode usernames, passwords, database names, and `authSource`.
- **Credential Redaction:** `sanitizeMongoUri()` (TypeScript) and `sanitize_log_message()` (Python) redact `user:pass@` before logging errors.
- **Template Safety:** [`.env.example`](../../.env.example) documents all variables using non-functional placeholders (`<replace_with_strong_...>`). `docker-compose.yml` uses isolated Docker-only fallback defaults explicitly labeled never to be reused in staging/production.
