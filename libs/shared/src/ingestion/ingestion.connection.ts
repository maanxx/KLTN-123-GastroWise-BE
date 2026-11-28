import { MongoClient } from 'mongodb';
import type { Db } from 'mongodb';
import { isRemoteOrAtlasMongoUri } from '../migrations/migration.connection';
import { redactSensitiveString } from '../migrations/migration.types';
import { IngestionValidationError } from './ingestion.types';

export interface ResolvedIngestionConnectionConfig {
  uri: string;
  dbName: string;
  redactedUri: string;
}

/**
 * Unconditionally blocks remote or MongoDB Atlas targets during M10.2 ingestion.
 * Only localhost / 127.0.0.1 / local Docker MongoDB targets (e.g. mongo-test) are permitted.
 */
export function assertLocalIngestionTargetOnly(uri: string): void {
  if (!uri || typeof uri !== 'string' || uri.trim().length === 0) {
    throw new IngestionValidationError(
      'MongoDB ingestion target URI is missing or empty.',
    );
  }

  let isRemote = false;
  try {
    isRemote = isRemoteOrAtlasMongoUri(uri);
  } catch (err) {
    throw new IngestionValidationError(
      err instanceof Error ? err.message : 'Invalid MongoDB ingestion URI.',
    );
  }

  if (isRemote) {
    const safeTarget = redactSensitiveString(uri);
    throw new IngestionValidationError(
      `Refusing ingestion against remote or MongoDB Atlas target (${safeTarget}). M10.2 ingestion is restricted to local/Docker isolated MongoDB only.`,
    );
  }
}

/**
 * Resolves local isolated Core MongoDB connection configuration strictly blocking Atlas/production URIs.
 */
export function resolveIngestionDatabaseConfig(
  env: Record<string, string | undefined> = process.env,
): ResolvedIngestionConnectionConfig {
  const uri = env.MONGODB_URI_CORE || env.CORE_MONGODB_URI || env.MONGODB_URI;
  if (!uri || uri.trim().length === 0) {
    throw new IngestionValidationError(
      'MONGODB_URI_CORE (or CORE_MONGODB_URI / MONGODB_URI) environment variable is required for local ingestion.',
    );
  }

  assertLocalIngestionTargetOnly(uri);

  const dbName = env.CORE_DB_NAME?.trim() || 'gastro_core_test';
  return {
    uri: uri.trim(),
    dbName,
    redactedUri: redactSensitiveString(uri.trim()),
  };
}

/**
 * Opens an isolated local MongoDB connection for ingestion and guarantees client cleanup.
 */
export async function withIngestionDatabase<T>(
  handler: (db: Db, config: ResolvedIngestionConnectionConfig) => Promise<T>,
  env: Record<string, string | undefined> = process.env,
): Promise<T> {
  const config = resolveIngestionDatabaseConfig(env);
  const client = new MongoClient(config.uri, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  });

  await client.connect();
  try {
    const db = client.db(config.dbName);
    return await handler(db, config);
  } finally {
    await client.close();
  }
}
