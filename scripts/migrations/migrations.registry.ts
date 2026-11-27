import { MigrationDefinition, MigrationRegistry } from '@shared/migrations';
import { v002UserSecurityFieldsMigration } from './core/v002_user_security_fields.migration';
import { v003GeoJsonCleanupMigration } from './core/v003_geojson_cleanup.migration';
import { v004ReferentialHygieneMigration } from './core/v004_referential_hygiene_and_uniqueness.migration';

/**
 * Central migration registry for GastroWise services.
 */
export const REGISTERED_MIGRATIONS: readonly MigrationDefinition[] = [
  v002UserSecurityFieldsMigration,
  v003GeoJsonCleanupMigration,
  v004ReferentialHygieneMigration,
];

export function createDefaultMigrationRegistry(): MigrationRegistry {
  return new MigrationRegistry(REGISTERED_MIGRATIONS);
}
