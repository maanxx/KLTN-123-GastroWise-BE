import { ConfigService } from '@nestjs/config';

export interface ResolveMongoUriOptions {
  /** Ordered explicit URI env variable names (e.g. ['CORE_MONGODB_URI', 'MONGODB_URI_CORE']). */
  uriEnvKeys: string[];
  /** Service username env key (e.g. 'CORE_DB_USER'). */
  userEnvKey: string;
  /** Service password env key (e.g. 'CORE_DB_PASSWORD'). */
  passwordEnvKey: string;
  /** Database name env key (e.g. 'CORE_DB_NAME'). */
  dbNameEnvKey: string;
  /** Fallback database name when dbNameEnvKey is unset. */
  defaultDbName: string;
}

/**
 * Masks credentials in MongoDB connection strings before logging.
 */
export function sanitizeMongoUri(value: string): string {
  if (!value) {
    return '';
  }
  return value.replace(
    /(mongodb(?:\+srv)?:\/\/)([^/@\s]+@)/gi,
    '$1[REDACTED_AUTH]@',
  );
}

/**
 * Resolves a service MongoDB connection URI cleanly, preferring explicit service URI overrides,
 * then safely URL-encoding discrete credentials (CORE_DB_USER/CORE_DB_PASSWORD, etc.),
 * and finally falling back to legacy shared MONGODB_URI.
 */
export function resolveServiceMongoUri(
  configService: Pick<ConfigService, 'get'>,
  options: ResolveMongoUriOptions,
): { uri: string; dbName: string } {
  const dbName =
    configService.get<string>(options.dbNameEnvKey)?.trim() ||
    options.defaultDbName;

  for (const key of options.uriEnvKeys) {
    const candidate = configService.get<string>(key)?.trim();
    if (candidate) {
      return { uri: candidate, dbName };
    }
  }

  const username = configService.get<string>(options.userEnvKey)?.trim();
  const password = configService.get<string>(options.passwordEnvKey)?.trim();
  if (username && password) {
    const host =
      configService.get<string>('MONGO_HOST')?.trim() || 'mongo-test';
    const port = configService.get<string>('MONGO_PORT')?.trim() || '27017';
    const authSource =
      configService.get<string>('MONGO_AUTH_SOURCE')?.trim() || dbName;

    const encodedUser = encodeURIComponent(username);
    const encodedPass = encodeURIComponent(password);
    const encodedDb = encodeURIComponent(dbName);
    const encodedAuthSource = encodeURIComponent(authSource);

    return {
      uri: `mongodb://${encodedUser}:${encodedPass}@${host}:${port}/${encodedDb}?authSource=${encodedAuthSource}`,
      dbName,
    };
  }

  const sharedFallback = configService.get<string>('MONGODB_URI')?.trim();
  if (sharedFallback) {
    return { uri: sharedFallback, dbName };
  }

  throw new Error(
    `${options.uriEnvKeys.join(' or ')} (or ${options.userEnvKey}/${options.passwordEnvKey}) environment variable is required`,
  );
}
