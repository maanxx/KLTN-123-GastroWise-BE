import { MigrationDefinition, MigrationRegistry } from '@shared/migrations';
import { v002UserSecurityFieldsMigration } from './core/v002_user_security_fields.migration';

/**
 * Central migration registry for GastroWise services.
 */
export const REGISTERED_MIGRATIONS: readonly MigrationDefinition[] = [
  v002UserSecurityFieldsMigration,
];

export function createDefaultMigrationRegistry(): MigrationRegistry {
  return new MigrationRegistry(REGISTERED_MIGRATIONS);
}
