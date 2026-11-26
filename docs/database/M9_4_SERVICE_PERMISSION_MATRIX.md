# M9.4 — MongoDB Service Permission Matrix

**Scope:** Isolated Docker staging (`gastrowise-mongo-test`, `mongo:7.0` with `--auth`)  
**Principle:** Strict database-per-service RBAC isolation with least-privilege database-scoped roles. No service account is granted `root`, `dbOwner`, `clusterAdmin`, or `readWriteAnyDatabase`.

---

## 1. Provisioned Accounts & Role Assignments

| Principal (`username`) | Owning Service | Authentication DB (`authSource`) | Assigned Built-In Role | Scope |
| :--- | :--- | :--- | :--- | :--- |
| `${MONGODB_ROOT_USERNAME}` (default `gastro_root_staging`) | Ops / Bootstrap Only | `admin` | `root` | `admin` (cluster administration & recovery) |
| `${CORE_DB_USER}` (default `gastro_core_svc`) | `core-service` | `gastro_core_test` | `readWrite` | `gastro_core_test` only |
| `${PLANNING_DB_USER}` (default `gastro_planning_svc`) | `planning-service` | `gastro_planning_test` | `readWrite` | `gastro_planning_test` only |
| `${AI_DB_USER}` (default `gastro_ai_reader`) | `ai-service` | `gastro_core_test` | `read` | `gastro_core_test` only |

**Distinct Account Invariant:** `CORE_DB_USER` and `AI_DB_USER` authenticate against `gastro_core_test` under strictly separate identities and credentials (`01-init-users.js` enforces `coreUser !== aiUser`).

---

## 2. Database & Collection Access Matrix

| Principal | `gastro_core_test.restaurants` (Read) | `gastro_core_test.*` (Insert / Update / Delete) | `gastro_planning_test.itineraries` (Read) | `gastro_planning_test.*` (Insert / Update / Delete) | `admin` (Read / Admin Cmds) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Unauthenticated client** | **DENY** (`13 Unauthorized`) | **DENY** (`13 Unauthorized`) | **DENY** (`13 Unauthorized`) | **DENY** (`13 Unauthorized`) | **DENY** (`13 Unauthorized`) |
| **`core-service` (`gastro_core_svc`)** | **ALLOW** | **ALLOW** | **DENY** (`13 Unauthorized`) | **DENY** (`13 Unauthorized`) | **DENY** |
| **`planning-service` (`gastro_planning_svc`)** | **DENY** (`13 Unauthorized`) | **DENY** (`13 Unauthorized`) | **ALLOW** | **ALLOW** | **DENY** |
| **`ai-service` (`gastro_ai_reader`)** | **ALLOW** | **DENY** (`13 Unauthorized`) | **DENY** (`13 Unauthorized`) | **DENY** (`13 Unauthorized`) | **DENY** |
| **Root operator (`gastro_root_staging`)** | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** |

---

## 3. Collection Ownership Enforcement

- **Core Service (`gastro_core_test`):** Owns `users`, `restaurants`, `menu_items`, `reviews`, `favorites`, `taste_dna_profiles`, `user_interactions`, `contacts`, and `_migrations_core`.
- **Planning Service (`gastro_planning_test`):** Owns `itineraries` and `_migrations_planning`; cross-service Core lookups go through Core's internal HTTP API (`/api/v1/internal/...`) rather than direct DB reads.
- **AI Service (`gastro_core_test.restaurants`):** Direct PyMongo access is constrained to read-only catalog ingestion. Any accidental write attempt (`insert`, `update`, `delete`) is rejected at the MongoDB engine layer with `MongoServerError: not authorized on gastro_core_test` (code `13`).
