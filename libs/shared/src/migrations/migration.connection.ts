import { MongoClient } from 'mongodb';
import type { Db } from 'mongodb';
import {
  MigrationDatabaseScope,
  MigrationValidationError,
  redactSensitiveString,
} from './migration.types';

export interface ResolvedDatabaseConnectionConfig {
  scope: MigrationDatabaseScope;
  uri: string;
  dbName: string;
  redactedUri: string;
}

export function resolveDatabaseConnectionConfig(
  scope: MigrationDatabaseScope,
  env: Record<string, string | undefined> = process.env,
): ResolvedDatabaseConnectionConfig {
  if (scope === 'core') {
    const uri = env.MONGODB_URI_CORE || env.MONGODB_URI;
    if (!uri) {
      throw new MigrationValidationError(
        'MONGODB_URI_CORE or MONGODB_URI environment variable is required for "core" migrations.',
      );
    }
    const dbName = env.CORE_DB_NAME || 'gastro_core';
    return {
      scope,
      uri,
      dbName,
      redactedUri: redactSensitiveString(uri),
    };
  }

  if (scope === 'planning') {
    const uri = env.MONGODB_URI_PLANNING || env.MONGODB_URI;
    if (!uri) {
      throw new MigrationValidationError(
        'MONGODB_URI_PLANNING or MONGODB_URI environment variable is required for "planning" migrations.',
      );
    }
    const dbName = env.PLANNING_DB_NAME || 'gastro_planning';
    return {
      scope,
      uri,
      dbName,
      redactedUri: redactSensitiveString(uri),
    };
  }

  throw new MigrationValidationError(
    `Unsupported migration scope "${String(scope)}".`,
  );
}

export async function withMigrationDatabase<T>(
  scope: MigrationDatabaseScope,
  fn: (db: Db, config: ResolvedDatabaseConnectionConfig) => Promise<T>,
  env: Record<string, string | undefined> = process.env,
): Promise<T> {
  const config = resolveDatabaseConnectionConfig(scope, env);
  const client = new MongoClient(config.uri, {
    serverSelectionTimeoutMS: 5000,
  });

  await client.connect();
  try {
    const db = client.db(config.dbName);
    return await fn(db, config);
  } finally {
    await client.close();
  }
}
