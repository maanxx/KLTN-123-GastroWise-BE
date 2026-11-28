import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_E2E_BASE_URL,
  KNOWN_MONGO_URI_ENV_KEYS,
  assertSafeLocalE2eEnvironment,
  assertSafeLocalMongoHost,
  parseAndAssertSafeLocalMongoUri,
} from './fixtures/itinerary-e2e.fixtures.mjs';

test('allows approved local MongoDB URI hosts: localhost, 127.0.0.1, [::1]', () => {
  const localCases = [
    ['mongodb://localhost:27017/gastro_core_test', ['localhost']],
    [
      'mongodb://localUser:localPass123@localhost:27017/gastro_planning_test?authSource=gastro_planning_test',
      ['localhost'],
    ],
    ['mongodb://127.0.0.1:27017/gastro_core_test', ['127.0.0.1']],
    ['mongodb://[::1]:27017/gastro_core_test', ['::1']],
  ];

  for (const [uri, expectedHosts] of localCases) {
    const parsed = parseAndAssertSafeLocalMongoUri(uri, 'MONGODB_URI_CORE');
    assert.deepEqual(parsed.hosts, expectedHosts);
  }
});

test('allows explicitly approved Docker Compose service hostnames (mongo-test, gastrowise-mongo-test)', () => {
  const dockerCases = [
    [
      'mongodb://coreUser:corePass@mongo-test:27017/gastro_core_test?authSource=gastro_core_test',
      ['mongo-test'],
    ],
    [
      'mongodb://planUser:planPass@gastrowise-mongo-test:27017/gastro_planning_test',
      ['gastrowise-mongo-test'],
    ],
    [
      'mongodb://localhost:27017,mongo-test:27017/gastro_core_test',
      ['localhost', 'mongo-test'],
    ],
  ];

  for (const [uri, expectedHosts] of dockerCases) {
    const parsed = parseAndAssertSafeLocalMongoUri(uri, 'CORE_MONGODB_URI');
    assert.deepEqual(parsed.hosts, expectedHosts);
  }

  assert.equal(assertSafeLocalMongoHost('mongo-test'), 'mongo-test');
  assert.equal(
    assertSafeLocalMongoHost('gastrowise-mongo-test'),
    'gastrowise-mongo-test',
  );
  assert.equal(assertSafeLocalMongoHost('localhost'), 'localhost');
  assert.equal(assertSafeLocalMongoHost('127.0.0.1'), '127.0.0.1');
});

test('rejects remote mongodb:// hostnames (single host, private IP, subdomain spoof, multi-host seedlist) without leaking credentials', () => {
  const secretUser = 'prodRootUser';
  const secretPass = 'UltraSecretProdPass987!';
  const remoteUris = [
    `mongodb://${secretUser}:${secretPass}@db.prod.gastrowise.vn:27017/gastro_core`,
    `mongodb://${secretUser}:${secretPass}@10.20.30.40:27017/gastro_planning`,
    `mongodb://${secretUser}:${secretPass}@localhost.evil.com:27017/gastro_core`,
    `mongodb://${secretUser}:${secretPass}@localhost:27017,remote-replica.example.com:27017/gastro_core`,
  ];

  for (const uri of remoteUris) {
    assert.throws(
      () => parseAndAssertSafeLocalMongoUri(uri, 'MONGODB_URI_CORE'),
      (err) => {
        assert.match(err.message, /non-local MongoDB host detected in MONGODB_URI_CORE/i);
        assert.doesNotMatch(err.message, new RegExp(secretUser));
        assert.doesNotMatch(err.message, new RegExp(secretPass));
        assert.doesNotMatch(err.message, /mongodb:\/\//i);
        return true;
      },
    );
  }

  assert.throws(
    () => assertSafeLocalMongoHost('db.prod.gastrowise.vn', 'MONGO_HOST'),
    (err) => {
      assert.match(err.message, /non-local MongoDB host detected in MONGO_HOST/i);
      assert.doesNotMatch(err.message, /db\.prod\.gastrowise\.vn/);
      return true;
    },
  );
});

test('rejects MongoDB Atlas mongodb+srv:// URIs without leaking credentials or connection string', () => {
  const secretUser = 'atlasAdmin';
  const secretPass = 'AtlasSecretXYZ789!';
  const atlasUris = [
    `mongodb+srv://${secretUser}:${secretPass}@cluster01.abcde.mongodb.net/gastrowise?retryWrites=true`,
    `mongodb+srv://${secretUser}:${secretPass}@localhost/gastro_core_test`,
  ];

  for (const uri of atlasUris) {
    assert.throws(
      () => parseAndAssertSafeLocalMongoUri(uri, 'MONGODB_URI'),
      (err) => {
        assert.match(err.message, /mongodb\+srv:\/\/.*forbidden in MONGODB_URI/i);
        assert.doesNotMatch(err.message, new RegExp(secretUser));
        assert.doesNotMatch(err.message, new RegExp(secretPass));
        assert.doesNotMatch(err.message, /cluster01\.abcde\.mongodb\.net/);
        return true;
      },
    );
  }
});

test('rejects malformed MongoDB URIs without leaking input values', () => {
  const malformedUris = [
    'not-a-valid-uri',
    'http://localhost:27017/gastro_core_test',
    'mongodb://',
    'mongodb://user:SecretMalformedPass@',
    'mongodb://:27017/gastro_core_test',
    'mongodb://localhost:/gastro_core_test',
    'mongodb://localhost:notaport/gastro_core_test',
    'mongodb://localhost:27017 /gastro_core_test',
    'mongodb://localhost:27017,/gastro_core_test',
  ];

  for (const uri of malformedUris) {
    assert.throws(
      () => parseAndAssertSafeLocalMongoUri(uri, 'PLANNING_MONGODB_URI'),
      (err) => {
        assert.match(err.message, /malformed|unsupported/i);
        assert.doesNotMatch(err.message, /SecretMalformedPass/);
        return true;
      },
    );
  }
});

test('rejects missing or empty MongoDB URIs when directly validated or required', () => {
  for (const missing of [undefined, null, '', '   ']) {
    assert.throws(
      () => parseAndAssertSafeLocalMongoUri(missing, 'MONGODB_URI_PLANNING'),
      /missing or empty MongoDB URI in MONGODB_URI_PLANNING/i,
    );
  }

  assert.throws(
    () =>
      assertSafeLocalE2eEnvironment(
        DEFAULT_E2E_BASE_URL,
        { CORE_MONGODB_URI: '', PLANNING_MONGODB_URI: '   ' },
        { requireMongoUri: true },
      ),
    /local MongoDB URI environment variable is required/i,
  );
});

test('inspects every repository and Docker Compose MongoDB environment variable', () => {
  const remoteUri = 'mongodb://u:SecretKey42@remote.db.internal:27017/prod';

  // Every known repo/Compose URI key must be inspected and reject remote URIs
  for (const key of KNOWN_MONGO_URI_ENV_KEYS) {
    assert.throws(
      () =>
        assertSafeLocalE2eEnvironment(DEFAULT_E2E_BASE_URL, {
          [key]: remoteUri,
        }),
      (err) => {
        assert.match(err.message, new RegExp(key));
        assert.doesNotMatch(err.message, /SecretKey42/);
        return true;
      },
    );
  }

  // Dynamic *MONGO*URI* key must also be caught
  assert.throws(
    () =>
      assertSafeLocalE2eEnvironment(DEFAULT_E2E_BASE_URL, {
        ANALYTICS_MONGO_URI: remoteUri,
      }),
    /ANALYTICS_MONGO_URI/,
  );

  // Discrete MONGO_HOST from docker-compose.yml must be inspected
  assert.throws(
    () =>
      assertSafeLocalE2eEnvironment(DEFAULT_E2E_BASE_URL, {
        MONGO_HOST: 'prod-mongo.example.com',
      }),
    /MONGO_HOST/,
  );

  // Docker Compose safe local env shape (empty URI overrides + approved MONGO_HOST) must pass
  assert.doesNotThrow(() =>
    assertSafeLocalE2eEnvironment(DEFAULT_E2E_BASE_URL, {
      CORE_MONGODB_URI: '',
      MONGODB_URI_CORE: '',
      PLANNING_MONGODB_URI: '',
      MONGODB_URI_PLANNING: '',
      MONGODB_URI: '',
      MONGO_HOST: 'mongo-test',
    }),
  );

  // Non-local E2E HTTP target must still be refused
  assert.throws(
    () => assertSafeLocalE2eEnvironment('https://api.gastrowise.vn', {}),
    /non-local host/i,
  );
});
