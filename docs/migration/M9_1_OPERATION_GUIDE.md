# M9.1 — Migration Runner Operational Guide

- **Prerequisite:** Ensure environment variables are configured via `.env` or secret manager (**never** pass MongoDB URIs or passwords as CLI arguments).
- **Important:** Always run `--dry-run` and capture a verified `mongodump` archive (`docs/database/M8_4_BACKUP_STRATEGY.md`) before executing migrations against staging or production.

---

## 1. CLI Commands (`package.json`)

All commands require `--scope=core` or `--scope=planning`.

### Check Migration Status
```bash
npm run migrate:status -- --scope=core
npm run migrate:status -- --scope=planning
```

### Dry-Run Pending Migrations (Zero DB Writes)
```bash
npm run migrate:up -- --scope=core --dry-run
npm run migrate:up -- --scope=planning --dry-run
```

### Execute Pending Migrations
```bash
npm run migrate:up -- --scope=core
npm run migrate:up -- --scope=planning
```

### Execute Up to a Specific Migration ID
```bash
npm run migrate:up -- --scope=core --target=20261126001_v001_indexes
```

### Retry a Failed Idempotent Migration
```bash
npm run migrate:up -- --scope=core --retry-failed-idempotent
```
*(Rejected automatically if the failed migration is marked `idempotency: 'non_idempotent'` or if any migration is stuck in `'running'`.)*

### Roll Back Reversible Migrations (Reverse Order)
```bash
# Preview rollback of the latest migration
npm run migrate:down -- --scope=core --steps=1 --dry-run

# Roll back the latest reversible migration
npm run migrate:down -- --scope=core --steps=1

# Roll back the latest applied migration by explicit ID
npm run migrate:down -- --scope=core --id=20261126001_v001_indexes
```
*(Blocked automatically with `IrreversibleMigrationError` if any target migration has `reversible: false` or skips newer applied migrations.)*

---

## 2. Structured Log Events

Every lifecycle step logs structured JSON with credential masking:
- `migration_cli_connected` (logs scope, `dbName`, and credential-redacted URI)
- `migration_discovery` & `pending_migrations_identified`
- `lock_acquired`, `stale_lock_recovered`, `lock_released`
- `migration_execution_started`, `migration_execution_completed`, `migration_execution_failed`
- `migration_rollback_started`, `migration_rollback_completed`, `migration_rollback_failed`

---

## 3. Authoring New Migrations (M9.2+)

Add migration definitions implementing `MigrationDefinition`:
- Provide unique `id`, monotonic `version`, clear `name`, explicit `database: 'core' | 'planning'`, honest `idempotency: 'idempotent' | 'non_idempotent'`, and `reversible: true | false`.
- Register migrations inside `scripts/migrations/migrations.registry.ts`.
- Never execute `Model.syncIndexes()` automatically during NestJS startup; manage index rollouts explicitly through reviewed migrations.
