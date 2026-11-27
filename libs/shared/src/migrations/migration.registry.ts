import { createHash } from 'crypto';
import {
  DuplicateMigrationError,
  MigrationDatabaseScope,
  MigrationDefinition,
  MigrationValidationError,
} from './migration.types';

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,127}$/;
const VERSION_PATTERN = /^v?(\d+(?:\.\d+)*)$/i;

export function parseVersionSegments(version: string): number[] {
  const match = VERSION_PATTERN.exec(version.trim());
  if (!match) {
    throw new MigrationValidationError(
      `Invalid migration version "${version}". Expected numeric or dot-separated version such as "001", "V001", or "1.0.0".`,
    );
  }
  return match[1].split('.').map((part) => Number.parseInt(part, 10));
}

export function compareVersions(a: string, b: string): number {
  const segA = parseVersionSegments(a);
  const segB = parseVersionSegments(b);
  const maxLen = Math.max(segA.length, segB.length);
  for (let i = 0; i < maxLen; i++) {
    const valA = segA[i] ?? 0;
    const valB = segB[i] ?? 0;
    if (valA !== valB) {
      return valA - valB;
    }
  }
  return 0;
}

export function computeMigrationChecksum(
  migration: MigrationDefinition,
): string {
  const canonical = JSON.stringify({
    id: migration.id,
    version: migration.version,
    name: migration.name,
    database: migration.database,
    idempotency: migration.idempotency,
    reversible: migration.reversible,
    up: migration.up.toString(),
    down: migration.down ? migration.down.toString() : null,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function validateMigrationDefinition(
  migration: MigrationDefinition,
): void {
  if (!migration || typeof migration !== 'object') {
    throw new MigrationValidationError(
      'Migration definition must be an object.',
    );
  }
  if (!migration.id || !ID_PATTERN.test(migration.id)) {
    throw new MigrationValidationError(
      `Invalid migration id "${String(migration.id)}". Must match ${ID_PATTERN.source}.`,
    );
  }
  parseVersionSegments(String(migration.version ?? ''));

  if (!migration.name || migration.name.trim().length < 3) {
    throw new MigrationValidationError(
      `Migration "${migration.id}" must declare a descriptive name (min 3 characters).`,
    );
  }
  if (migration.database !== 'core' && migration.database !== 'planning') {
    throw new MigrationValidationError(
      `Migration "${migration.id}" has invalid database scope "${String(migration.database)}". Expected "core" or "planning".`,
    );
  }
  if (
    migration.idempotency !== 'idempotent' &&
    migration.idempotency !== 'non_idempotent'
  ) {
    throw new MigrationValidationError(
      `Migration "${migration.id}" must specify idempotency as "idempotent" or "non_idempotent".`,
    );
  }
  if (typeof migration.reversible !== 'boolean') {
    throw new MigrationValidationError(
      `Migration "${migration.id}" must declare boolean "reversible".`,
    );
  }
  if (typeof migration.up !== 'function') {
    throw new MigrationValidationError(
      `Migration "${migration.id}" must define an async up(ctx) function.`,
    );
  }
  if (migration.reversible && typeof migration.down !== 'function') {
    throw new MigrationValidationError(
      `Migration "${migration.id}" is marked reversible=true but does not implement down(ctx).`,
    );
  }
  if (!migration.reversible && typeof migration.down === 'function') {
    throw new MigrationValidationError(
      `Migration "${migration.id}" is marked reversible=false and must not expose a down(ctx) handler.`,
    );
  }
}

export class MigrationRegistry {
  private readonly migrations: MigrationDefinition[] = [];

  constructor(initialMigrations: readonly MigrationDefinition[] = []) {
    for (const migration of initialMigrations) {
      this.register(migration);
    }
  }

  register(migration: MigrationDefinition): void {
    validateMigrationDefinition(migration);

    if (this.migrations.some((m) => m.id === migration.id)) {
      throw new DuplicateMigrationError(
        `Duplicate migration id detected: "${migration.id}".`,
      );
    }

    const sameScopeVersion = this.migrations.find(
      (m) =>
        m.database === migration.database &&
        compareVersions(m.version, migration.version) === 0,
    );
    if (sameScopeVersion) {
      throw new DuplicateMigrationError(
        `Duplicate migration version "${migration.version}" for database "${migration.database}" (conflicts with "${sameScopeVersion.id}").`,
      );
    }

    this.migrations.push(migration);
  }

  getAll(scope?: MigrationDatabaseScope): MigrationDefinition[] {
    const filtered = scope
      ? this.migrations.filter((m) => m.database === scope)
      : [...this.migrations];

    return filtered.sort((a, b) => {
      const versionDiff = compareVersions(a.version, b.version);
      if (versionDiff !== 0) return versionDiff;
      if (a.database !== b.database) {
        return a.database.localeCompare(b.database);
      }
      return a.id.localeCompare(b.id);
    });
  }

  getById(id: string): MigrationDefinition | undefined {
    return this.migrations.find((m) => m.id === id);
  }
}
