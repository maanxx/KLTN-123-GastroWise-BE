import {
  resolveServiceMongoUri,
  sanitizeMongoUri,
} from './mongo-uri.util';

describe('mongo-uri.util', () => {
  const makeConfig = (values: Record<string, string | undefined>) => ({
    get: <T = string>(key: string): T | undefined => values[key] as T | undefined,
  });

  it('prefers explicit service URI env keys before discrete credentials or fallback', () => {
    const res = resolveServiceMongoUri(
      makeConfig({
        CORE_MONGODB_URI: 'mongodb://explicit:pw@mongo:27017/gastro_core_test?authSource=gastro_core_test',
        MONGODB_URI_CORE: 'mongodb://older:pw@mongo:27017/gastro_core_test',
        CORE_DB_USER: 'ignored',
        CORE_DB_PASSWORD: 'ignored',
        CORE_DB_NAME: 'gastro_core_test',
      }),
      {
        uriEnvKeys: ['CORE_MONGODB_URI', 'MONGODB_URI_CORE'],
        userEnvKey: 'CORE_DB_USER',
        passwordEnvKey: 'CORE_DB_PASSWORD',
        dbNameEnvKey: 'CORE_DB_NAME',
        defaultDbName: 'gastro_core',
      },
    );

    expect(res.uri).toContain('mongodb://explicit:pw@');
    expect(res.dbName).toBe('gastro_core_test');
  });

  it('percent-encodes special characters when assembling URI from discrete credentials', () => {
    const res = resolveServiceMongoUri(
      makeConfig({
        CORE_DB_USER: 'core@svc',
        CORE_DB_PASSWORD: 'p@ss:w/rd#1?',
        CORE_DB_NAME: 'gastro_core_test',
        MONGO_HOST: 'mongo-test',
        MONGO_PORT: '27017',
      }),
      {
        uriEnvKeys: ['CORE_MONGODB_URI', 'MONGODB_URI_CORE'],
        userEnvKey: 'CORE_DB_USER',
        passwordEnvKey: 'CORE_DB_PASSWORD',
        dbNameEnvKey: 'CORE_DB_NAME',
        defaultDbName: 'gastro_core',
      },
    );

    expect(res.uri).toBe(
      'mongodb://core%40svc:p%40ss%3Aw%2Frd%231%3F@mongo-test:27017/gastro_core_test?authSource=gastro_core_test',
    );
  });

  it('throws clear error without leaking secrets when no URI or credentials are provided', () => {
    expect(() =>
      resolveServiceMongoUri(makeConfig({}), {
        uriEnvKeys: ['PLANNING_MONGODB_URI', 'MONGODB_URI_PLANNING'],
        userEnvKey: 'PLANNING_DB_USER',
        passwordEnvKey: 'PLANNING_DB_PASSWORD',
        dbNameEnvKey: 'PLANNING_DB_NAME',
        defaultDbName: 'gastro_planning',
      }),
    ).toThrow(/PLANNING_MONGODB_URI or MONGODB_URI_PLANNING/);
  });

  it('masks credentials in mongodb and mongodb+srv URIs', () => {
    expect(
      sanitizeMongoUri(
        'Authentication failed on mongodb://core_user:SuperSecret!123@mongo-test:27017/gastro_core_test',
      ),
    ).toBe(
      'Authentication failed on mongodb://[REDACTED_AUTH]@mongo-test:27017/gastro_core_test',
    );
    expect(
      sanitizeMongoUri('mongodb+srv://admin:s3cr3t@cluster0.mongodb.net/db'),
    ).toBe('mongodb+srv://[REDACTED_AUTH]@cluster0.mongodb.net/db');
  });
});
