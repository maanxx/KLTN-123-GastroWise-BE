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
  atlasAuthorized: boolean;
}

export interface MigrationTargetGuardOptions {
  allowAtlas?: boolean;
}

const SAFE_LOCAL_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  '0.0.0.0',
  'host.docker.internal',
]);

const DOCKER_SERVICE_HOST_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

function extractHostsFromMongoUri(uri: string): {
  scheme: 'mongodb' | 'mongodb+srv';
  hosts: string[];
} {
  const trimmed = uri.trim();
  let scheme: 'mongodb' | 'mongodb+srv';
  let remainder: string;

  if (trimmed.startsWith('mongodb+srv://')) {
    scheme = 'mongodb+srv';
    remainder = trimmed.slice('mongodb+srv://'.length);
  } else if (trimmed.startsWith('mongodb://')) {
    scheme = 'mongodb';
    remainder = trimmed.slice('mongodb://'.length);
  } else {
    throw new MigrationValidationError(
      'Invalid MongoDB URI scheme: URI must start with "mongodb://" or "mongodb+srv://".',
    );
  }

  const slashIdx = remainder.indexOf('/');
  const queryIdx = remainder.indexOf('?');
  const cutIdx =
    slashIdx === -1
      ? queryIdx
      : queryIdx === -1
        ? slashIdx
        : Math.min(slashIdx, queryIdx);
  const authority = cutIdx === -1 ? remainder : remainder.slice(0, cutIdx);
  const atIdx = authority.lastIndexOf('@');
  const hostSection = atIdx === -1 ? authority : authority.slice(atIdx + 1);

  if (!hostSection) {
    throw new MigrationValidationError(
      'Invalid MongoDB URI: missing target hostname.',
    );
  }

  const hosts = hostSection
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      if (entry.startsWith('[')) {
        const closeIdx = entry.indexOf(']');
        return closeIdx === -1 ? entry : entry.slice(0, closeIdx + 1);
      }
      const colonIdx = entry.indexOf(':');
      return colonIdx === -1 ? entry : entry.slice(0, colonIdx);
    });

  if (hosts.length === 0 || hosts.some((h) => h.length === 0)) {
    throw new MigrationValidationError(
      'Invalid MongoDB URI: unable to parse target host.',
    );
  }

  return { scheme, hosts };
}

function isSafeLocalOrDockerHost(host: string): boolean {
  if (SAFE_LOCAL_HOSTNAMES.has(host)) {
    return true;
  }
  return DOCKER_SERVICE_HOST_REGEX.test(host) && !host.includes('.');
}

export function isRemoteOrAtlasMongoUri(uri: string): boolean {
  const { scheme, hosts } = extractHostsFromMongoUri(uri);
  if (scheme === 'mongodb+srv') {
    return true;
  }
  return hosts.some(
    (host) =>
      host === 'mongodb.net' ||
      host.endsWith('.mongodb.net') ||
      !isSafeLocalOrDockerHost(host),
  );
}

export function assertMigrationTargetAuthorized(
  uri: string,
  options: MigrationTargetGuardOptions = {},
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!uri || typeof uri !== 'string' || uri.trim().length === 0) {
    throw new MigrationValidationError(
      'MongoDB migration target URI is missing or empty.',
    );
  }

  const requiresAuthorization = isRemoteOrAtlasMongoUri(uri);
  const authorized =
    options.allowAtlas === true || env.ALLOW_ATLAS_MIGRATION === 'true';

  if (requiresAuthorization && !authorized) {
    const safeTarget = redactSensitiveString(uri);
    throw new MigrationValidationError(
      `Refusing migration against remote/Atlas target (${safeTarget}) without explicit authorization. Set ALLOW_ATLAS_MIGRATION=true or pass --allow-atlas.`,
    );
  }

  return requiresAuthorization && authorized;
}

export function resolveDatabaseConnectionConfig(
  scope: MigrationDatabaseScope,
  env: Record<string, string | undefined> = process.env,
  options: MigrationTargetGuardOptions = {},
): ResolvedDatabaseConnectionConfig {
  if (scope === 'core') {
    const uri = env.MONGODB_URI_CORE || env.MONGODB_URI;
    if (!uri) {
      throw new MigrationValidationError(
        'MONGODB_URI_CORE or MONGODB_URI environment variable is required for "core" migrations.',
      );
    }
    const atlasAuthorized = assertMigrationTargetAuthorized(uri, options, env);
    const dbName = env.CORE_DB_NAME || 'gastro_core';
    return {
      scope,
      uri,
      dbName,
      redactedUri: redactSensitiveString(uri),
      atlasAuthorized,
    };
  }

  if (scope === 'planning') {
    const uri = env.MONGODB_URI_PLANNING || env.MONGODB_URI;
    if (!uri) {
      throw new MigrationValidationError(
        'MONGODB_URI_PLANNING or MONGODB_URI environment variable is required for "planning" migrations.',
      );
    }
    const atlasAuthorized = assertMigrationTargetAuthorized(uri, options, env);
    const dbName = env.PLANNING_DB_NAME || 'gastro_planning';
    return {
      scope,
      uri,
      dbName,
      redactedUri: redactSensitiveString(uri),
      atlasAuthorized,
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
  options: MigrationTargetGuardOptions = {},
): Promise<T> {
  const config = resolveDatabaseConnectionConfig(scope, env, options);
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
