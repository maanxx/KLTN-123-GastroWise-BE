/**
 * Idempotent MongoDB SCRAM User Initialization Script (Docker Staging / Local Dev).
 *
 * Executed automatically by mongo:7.0 /docker-entrypoint-initdb.d on fresh DB initialization,
 * and safe to invoke against an existing pre-auth instance via ensure-auth-users.sh.
 *
 * Security invariants:
 * - Reads all credentials exclusively from environment variables (zero hardcoded secrets).
 * - Grants least-privilege database-scoped roles only:
 *     - core-service     -> readWrite on CORE_DB_NAME (default: gastro_core_test)
 *     - planning-service -> readWrite on PLANNING_DB_NAME (default: gastro_planning_test)
 *     - ai-service       -> read ONLY on CORE_DB_NAME (default: gastro_core_test)
 * - Never grants root, dbOwner, clusterAdmin, or readWriteAnyDatabase to service accounts.
 */

function requireEnv(name) {
  const val = process.env[name];
  if (!val || !val.trim()) {
    throw new Error(`[mongo-init] Missing required environment variable: ${name}`);
  }
  return val.trim();
}

function upsertScopedUser(databaseName, username, password, roles) {
  const targetDb = db.getSiblingDB(databaseName);
  const existing = targetDb.getUser(username);
  if (existing) {
    targetDb.updateUser(username, {
      pwd: password,
      roles: roles,
    });
    print(`[mongo-init] Updated user "${username}" on "${databaseName}" with roles=${JSON.stringify(roles)}`);
  } else {
    targetDb.createUser({
      user: username,
      pwd: password,
      roles: roles,
    });
    print(`[mongo-init] Created user "${username}" on "${databaseName}" with roles=${JSON.stringify(roles)}`);
  }
}

(function main() {
  const rootUser = process.env.MONGO_INITDB_ROOT_USERNAME || process.env.MONGODB_ROOT_USERNAME;
  const rootPass = process.env.MONGO_INITDB_ROOT_PASSWORD || process.env.MONGODB_ROOT_PASSWORD;

  const coreDbName = (process.env.CORE_DB_NAME || 'gastro_core_test').trim();
  const planningDbName = (process.env.PLANNING_DB_NAME || 'gastro_planning_test').trim();

  const coreUser = requireEnv('CORE_DB_USER');
  const corePass = requireEnv('CORE_DB_PASSWORD');
  const planningUser = requireEnv('PLANNING_DB_USER');
  const planningPass = requireEnv('PLANNING_DB_PASSWORD');
  const aiUser = requireEnv('AI_DB_USER');
  const aiPass = requireEnv('AI_DB_PASSWORD');

  // Guard against distinct-service credential collision on same auth database.
  if (coreUser === aiUser) {
    throw new Error('[mongo-init] CORE_DB_USER and AI_DB_USER must be distinct accounts.');
  }

  // Ensure root admin exists in admin database when bootstrapping an existing pre-auth volume.
  if (rootUser && rootPass) {
    upsertScopedUser('admin', rootUser.trim(), rootPass.trim(), [{ role: 'root', db: 'admin' }]);
  }

  // Core Service: readWrite scoped exclusively to gastro_core_test
  upsertScopedUser(coreDbName, coreUser, corePass, [
    { role: 'readWrite', db: coreDbName },
  ]);

  // Planning Service: readWrite scoped exclusively to gastro_planning_test
  upsertScopedUser(planningDbName, planningUser, planningPass, [
    { role: 'readWrite', db: planningDbName },
  ]);

  // AI Service: strictly read-only on gastro_core_test
  upsertScopedUser(coreDbName, aiUser, aiPass, [
    { role: 'read', db: coreDbName },
  ]);

  print('[mongo-init] Idempotent SCRAM user provisioning complete.');
})();
