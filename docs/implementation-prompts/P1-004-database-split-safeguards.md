# IMPLEMENTATION PROMPT: P1-004 – DATABASE SPLIT 4-STAGE PIPELINE & DATA INTEGRITY VERIFICATION

## 1. OBJECTIVE
Implement and execute a safe, 4-stage database migration pipeline splitting monolithic database `gastrowise` into isolated databases `gastro_core` and `gastro_planning` with automated snapshot backup, `$merge` aggregation, document count parity verification, and rollback capability.

## 2. PROBLEM DESCRIPTION
The original migration plan proposed a 1-step raw `$out` aggregation pipeline. `$out` replaces collections atomically without preserving indexes (dropping the `2dsphere` index on `restaurants`) and offers zero pre-migration dump, parity validation, or rollback drill.

## 3. SOURCE FILES TO INSPECT
- `KLTN-123-GastroWise-BE/docs/architecture/DATABASE_OWNERSHIP.md`: Section 4.
- `KLTN-123-GastroWise-BE/src/app.module.ts`: Mongoose connection string.

## 4. FILES ALLOWED TO MODIFY
- `KLTN-123-GastroWise-BE/scripts/migrations/split-databases.js` (Create)
- `KLTN-123-GastroWise-BE/scripts/migrations/verify-parity.js` (Create)
- `KLTN-123-GastroWise-BE/scripts/migrations/rollback-split.js` (Create)

## 5. FILES THAT MUST NOT BE MODIFIED
- Production/Atlas `gastrowise` database (Must remain read-only during migration!).
- Any backend source code during script testing.

## 6. EXPECTED BEHAVIOR
- Stage 1: Full `mongodump` archive created and verified before migration.
- Stage 2: Controlled `$merge` copies collections to `gastro_core` and `gastro_planning`.
- Stage 3: Automated parity check verifies that `countDocuments()` across all collections matches 100% between source and target, and rebuilds indexes (`2dsphere`, `unique: true`).
- Stage 4: If any assertion fails, target databases are dropped and services point back to `gastrowise`.

## 7. TECHNICAL CONSTRAINTS
- Zero data loss guarantee.
- Zero mutation on source database `gastrowise`.

## 8. ACCEPTANCE CRITERIA
- Parity script asserts `assert(origCount === targetCount)` for all 9 collections without error.
- Geospatial query on `gastro_core.restaurants` functions with `2dsphere` index.
- Itineraries in `gastro_planning` retain all embedded stops.

## 9. UNIT TESTS
- Dry-run script on local test database verifying `$merge` logic.

## 10. INTEGRATION TESTS
- Start Core Service against `gastro_core`; start Planning Service against `gastro_planning`. Verify login, restaurant search, and itinerary view work without errors.

## 11. REGRESSION TESTS
- Verify existing itineraries in mobile app view remain intact.

## 12. VERIFICATION COMMANDS
```bash
node scripts/migrations/verify-parity.js
```

## 13. ROLLBACK CONSIDERATIONS
Revert `MONGODB_URI` environment variable to `gastrowise`.

