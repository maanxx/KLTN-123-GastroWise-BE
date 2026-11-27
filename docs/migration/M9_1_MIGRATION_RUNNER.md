# M9.1 — Versioned TypeScript MongoDB Migration Runner Architecture

- **Repository:** `maanxx/KLTN-123-GastroWise-BE`
- **Branch:** `feature/m9-1-versioned-migration-runner`
- **Addresses Blocker:** `BLK-08` (`M8_8_BLOCKER_REGISTER.md`) / Roadmap `P1.1` (`M8_8_REMEDIATION_ROADMAP.md`)
- **Framework Location:** [`libs/shared/src/migrations/`](../../libs/shared/src/migrations) & [`scripts/migrations/`](../../scripts/migrations)

---

## 1. Architecture Overview

The GastroWise migration framework uses native `mongodb` driver primitives inside `@shared/migrations` (introducing **zero** new external npm dependencies) and respects the strict **Database-per-Service** isolation boundary:

- **`core` scope:** connects using `MONGODB_URI_CORE` (fallback `MONGODB_URI`) and `CORE_DB_NAME` (default `gastro_core`).
- **`planning` scope:** connects using `MONGODB_URI_PLANNING` (fallback `MONGODB_URI`) and `PLANNING_DB_NAME` (default `gastro_planning`).

### Core Modules
1. **`migration.types.ts`:** Strict interfaces (`MigrationDefinition`, `MigrationContext`, `MigrationHistoryDocument`, `MigrationLockDocument`), typed domain errors, URI secret redaction (`redactSensitiveString`), and structured JSON logger (`JsonMigrationLogger`).
2. **`migration.registry.ts`:** `MigrationRegistry` validates metadata (`id`, numeric/dotted `version`, `name`, `database` scope, `idempotency`, explicit `reversible` + `down` pairing), rejects duplicate IDs or per-scope versions, computes deterministic SHA-256 checksums, and sorts migrations in deterministic ascending version order.
3. **`migration.history.ts`:** `MigrationHistoryStore` persists execution state in `schema_migrations` with a unique compound index `{ version: 1, database: 1 }` and query index `{ database: 1, status: 1, startedAt: -1 }`. Tracks `status` (`running`, `applied`, `failed`, `rolled_back`), `startedAt`, `completedAt`, `durationMs`, `runnerId`, and credential-redacted `error`.
4. **`migration.lock.ts`:** `MigrationLockManager` enforces mutual exclusion via `schema_migration_locks` using per-scope primary key uniqueness (`migration_lock:<scope>`) plus atomic `findOneAndUpdate({ _id, expiresAt: { $lte: now } })` stale-lock takeover and a MongoDB TTL index (`{ expiresAt: 1 }`, `expireAfterSeconds: 0`).
5. **`migration.engine.ts`:** `MigrationEngine` orchestrates `status()`, `up()`, and `down()` across lifecycle checks, incomplete-run guards, reverse-order rollback validation, and guaranteed lock release in `finally`.
6. **`migration.connection.ts` & `scripts/migrations/cli.ts`:** Env-only DB resolver (`--uri`/`--password` CLI flags rejected) exposing `npm run migrate:status`, `npm run migrate:up`, and `npm run migrate:down`.

---

## 2. Idempotency, Failure States & Recovery Semantics

| State / Classification | Runner Behavior | Operator Action Required |
|---|---|---|
| **`applied`** | Skipped automatically on subsequent `up()` runs | None |
| **`running` (Incomplete)** | Blocks all new `up()` runs (`IncompleteMigrationError`) | Verify DB state/backup; manually resolve or restore before clearing |
| **`failed` + `non_idempotent`** | Blocks automatic rerun even if `--retry-failed-idempotent` is passed | Restore from pre-migration backup (`M8_4_RESTORE_RUNBOOK.md`) or apply manual remediation |
| **`failed` + `idempotent`** | Blocked by default; eligible for retry only when `--retry-failed-idempotent` is explicitly specified | Inspect transient error, then rerun with `--retry-failed-idempotent` |
| **`rolled_back`** | Treated as eligible pending migration on next `up()` | Re-run when ready |
| **`reversible: false`** | Refuses `down()` pre-flight (`IrreversibleMigrationError`) before mutating any data | Use `_archive_*` restore or `mongorestore` (`M8_4_RESTORE_RUNBOOK.md`) |

---

## 3. Known Operational Limitations (Current Scope)
- **No Built-In Multi-Document Transaction Wrapper:** Migrations run against standalone/shared MongoDB topologies as well as Replica Sets; migrations needing archive safety must write pre-images explicitly (per `M8_3` `V004`).
- **Empty Production Migration List in M9.1:** `scripts/migrations/migrations.registry.ts` currently registers `[]` intentionally so unreviewed business-data mutations (`V001`–`V006`) are only registered in dedicated remediation milestones after `P0` schema/DTO blockers pass.
- **Standalone Lock Heartbeat:** Lock TTL defaults to `5` minutes (`300,000 ms`); migrations exceeding `5` minutes should execute in bounded batches or specify an extended `lockTtlMs`.
