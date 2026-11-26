import { MigrationDefinition, MigrationRegistry } from '@shared/migrations';

/**
 * Central migration registry for GastroWise services.
 *
 * M9.1 establishes the versioned runner infrastructure without registering
 * unreviewed business-data migrations. Future reviewed waves (M8.3 V001-V006)
 * should be imported and registered deterministically here per database scope.
 */
export const REGISTERED_MIGRATIONS: readonly MigrationDefinition[] = [];

export function createDefaultMigrationRegistry(): MigrationRegistry {
  return new MigrationRegistry(REGISTERED_MIGRATIONS);
}
