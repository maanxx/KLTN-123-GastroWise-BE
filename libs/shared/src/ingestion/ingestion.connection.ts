import { MongoClient } from 'mongodb';
import type { Db } from 'mongodb';
import { redactSensitiveString } from '../migrations/migration.types';
import {
  APPROVED_INGESTION_DB_NAME,
  IngestionValidationError,
} from './ingestion.types';

export interface ResolvedIngestionConnectionConfig {
  uri: string;
  dbName: string;
  redactedUri: string;
}

const APPROVED_LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  'mongo-test',
  'gastrowise-mongo-test',
]);

const FORBIDDEN_DB_NAMES = new Set([
  'gastro_core',
  'gastrowise',
  'gastro_planning',
  'gastro_planning_test',
  'admin',
  'local',
  'config',
  'test',
]);

function parseAndValidateIngestionMongoUri(uri: string): {
  host: string;
  uriDbName: string;
} {
  if (!uri || typeof uri !== 'string' || uri.trim().length === 0) {
    throw new IngestionValidationError(
      'MongoDB ingestion target URI is missing or empty.',
    );
  }

  const trimmed = uri.trim();
  const safeUri = redactSensitiveString(trimmed);

  if (trimmed.startsWith('mongodb+srv://')) {
    throw new IngestionValidationError(
      `Refusing ingestion against SRV/Atlas URI (${safeUri}). Only local mongodb:// targets are allowed.`,
    );
  }

  if (!trimmed.startsWith('mongodb://')) {
    throw new IngestionValidationError(
      `Invalid MongoDB ingestion URI scheme (${safeUri}): expected "mongodb://".`,
    );
  }

  const remainder = trimmed.slice('mongodb://'.length);
  const slashIdx = remainder.indexOf('/');
  const queryIdx = remainder.indexOf('?');

  if (queryIdx !== -1 && (slashIdx === -1 || queryIdx < slashIdx)) {
    throw new IngestionValidationError(
      `MongoDB ingestion URI (${safeUri}) must explicitly include database "/${APPROVED_INGESTION_DB_NAME}" in its path.`,
    );
  }

  const authority = slashIdx === -1 ? remainder : remainder.slice(0, slashIdx);
  const atIdx = authority.lastIndexOf('@');
  const hostSection = atIdx === -1 ? authority : authority.slice(atIdx + 1);

  if (!hostSection) {
    throw new IngestionValidationError(
      `Invalid MongoDB ingestion URI (${safeUri}): missing hostname.`,
    );
  }

  const rawHosts = hostSection
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);

  if (rawHosts.length !== 1) {
    throw new IngestionValidationError(
      `Refusing ingestion against multi-host cluster URI (${safeUri}). Only a single approved local test MongoDB host is allowed.`,
    );
  }

  const singleEntry = rawHosts[0];
  let host = singleEntry;
  if (singleEntry.startsWith('[')) {
    const closeIdx = singleEntry.indexOf(']');
    if (closeIdx === -1) {
      throw new IngestionValidationError(
        `Malformed IPv6 host in MongoDB URI (${safeUri}).`,
      );
    }
    host = singleEntry.slice(0, closeIdx + 1);
  } else {
    const colonIdx = singleEntry.indexOf(':');
    if (colonIdx !== -1) {
      const portPart = singleEntry.slice(colonIdx + 1);
      if (!/^\d+$/.test(portPart)) {
        throw new IngestionValidationError(
          `Invalid port specification in MongoDB URI (${safeUri}).`,
        );
      }
      host = singleEntry.slice(0, colonIdx);
    }
  }

  if (!APPROVED_LOCAL_HOSTS.has(host)) {
    throw new IngestionValidationError(
      `Refusing ingestion against unapproved MongoDB host "${host}" (${safeUri}). Approved hosts: ${Array.from(APPROVED_LOCAL_HOSTS).join(', ')}.`,
    );
  }

  if (slashIdx === -1) {
    throw new IngestionValidationError(
      `MongoDB ingestion URI (${safeUri}) must explicitly specify database "/${APPROVED_INGESTION_DB_NAME}".`,
    );
  }

  const pathAndQuery = remainder.slice(slashIdx + 1);
  const qIdx = pathAndQuery.indexOf('?');
  const dbSegment = (
    qIdx === -1 ? pathAndQuery : pathAndQuery.slice(0, qIdx)
  ).trim();
  const querySegment = qIdx === -1 ? '' : pathAndQuery.slice(qIdx + 1);

  if (!dbSegment || dbSegment.includes('/')) {
    throw new IngestionValidationError(
      `MongoDB ingestion URI (${safeUri}) has missing or invalid database path; expected "/${APPROVED_INGESTION_DB_NAME}".`,
    );
  }

  const uriDbName = decodeURIComponent(dbSegment);

  if (querySegment) {
    const params = new URLSearchParams(querySegment);
    const authSource = params.get('authSource')?.trim();
    if (
      authSource &&
      authSource !== APPROVED_INGESTION_DB_NAME &&
      authSource !== 'admin'
    ) {
      throw new IngestionValidationError(
        `Refusing ingestion URI with unapproved authSource="${authSource}" (${safeUri}).`,
      );
    }
  }

  return { host, uriDbName };
}

/**
 * Fail-closed guard enforcing that M10.2 ingestion targets ONLY an explicitly approved
 * local/Docker test host AND database `gastro_core_test`, with URI DB matching config DB.
 */
export function assertLocalIngestionTargetOnly(
  uri: string,
  configuredDbName?: string,
): { host: string; dbName: string } {
  const safeUri = redactSensitiveString(uri || '');
  const { host, uriDbName } = parseAndValidateIngestionMongoUri(uri);

  const expectedDbName = configuredDbName?.trim();
  if (expectedDbName !== undefined && expectedDbName.length > 0) {
    if (
      FORBIDDEN_DB_NAMES.has(expectedDbName.toLowerCase()) ||
      expectedDbName !== APPROVED_INGESTION_DB_NAME
    ) {
      throw new IngestionValidationError(
        `Refusing ingestion with forbidden or unapproved CORE_DB_NAME="${expectedDbName}". Only "${APPROVED_INGESTION_DB_NAME}" is permitted.`,
      );
    }

    if (uriDbName !== expectedDbName) {
      throw new IngestionValidationError(
        `MongoDB URI database "${uriDbName}" does not match configured CORE_DB_NAME "${expectedDbName}". Refusing ambiguous target.`,
      );
    }
  }

  if (
    FORBIDDEN_DB_NAMES.has(uriDbName.toLowerCase()) ||
    uriDbName !== APPROVED_INGESTION_DB_NAME
  ) {
    throw new IngestionValidationError(
      `Refusing ingestion against forbidden or unapproved URI database "${uriDbName}" (${safeUri}). Only "${APPROVED_INGESTION_DB_NAME}" is permitted.`,
    );
  }

  return { host, dbName: uriDbName };
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

  if (env.CORE_DB_NAME !== undefined && env.CORE_DB_NAME.trim().length === 0) {
    throw new IngestionValidationError(
      'CORE_DB_NAME environment variable is empty; expected "gastro_core_test".',
    );
  }

  const configuredDbName =
    env.CORE_DB_NAME?.trim() || APPROVED_INGESTION_DB_NAME;
  const { dbName } = assertLocalIngestionTargetOnly(uri, configuredDbName);

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
