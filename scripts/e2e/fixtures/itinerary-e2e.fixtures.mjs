/**
 * GastroWise M10.12 — Reusable Local-Only Authenticated E2E Test Fixtures
 *
 * Safety invariants:
 * - Strictly refuses any non-local HTTP target (only 127.0.0.1 / localhost / ::1).
 * - Strictly parses and validates every MongoDB URI / host environment variable used by
 *   this repository and Docker Compose against an explicit local/Docker allowlist.
 * - Rejects remote mongodb:// hosts, all mongodb+srv:// (Atlas) URIs, malformed URIs,
 *   and missing required URIs — without ever printing credentials or raw URIs in errors/logs.
 * - Uses isolated ephemeral test users (`e2e-m1012-*@local.gastrowise.test`) and
 *   test-only JWT signing helpers; never touches production or real user accounts.
 * - Cleans up only test-owned records created during the run.
 */

import { createHmac, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const APPROVED_LOCAL_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
  '[::1]',
]);

export const APPROVED_LOCAL_MONGO_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  'mongo-test',
  'gastrowise-mongo-test',
]);

export const KNOWN_MONGO_URI_ENV_KEYS = Object.freeze([
  'MONGODB_URI',
  'MONGODB_URI_CORE',
  'MONGODB_URI_PLANNING',
  'CORE_MONGODB_URI',
  'PLANNING_MONGODB_URI',
  'BACKUP_MONGO_URI',
]);

export const KNOWN_MONGO_HOST_ENV_KEYS = Object.freeze(['MONGO_HOST']);

export const DEFAULT_E2E_BASE_URL = 'http://127.0.0.1:8080';

function normalizeHostToken(rawHost) {
  const trimmed = String(rawHost).trim().toLowerCase();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Validates a discrete MongoDB hostname variable (e.g., MONGO_HOST) against the
 * explicit local/Docker allowlist without printing raw values.
 */
export function assertSafeLocalMongoHost(rawHost, envKey = 'MONGO_HOST') {
  if (typeof rawHost !== 'string' || rawHost.trim().length === 0) {
    throw new Error(
      `Refusing E2E run: missing or empty MongoDB host in ${envKey}.`,
    );
  }

  const trimmed = rawHost.trim();
  if (/[\s/@:?#,]/.test(trimmed)) {
    throw new Error(
      `Refusing E2E run: malformed MongoDB host in ${envKey}.`,
    );
  }

  const normalized = normalizeHostToken(trimmed);
  if (!APPROVED_LOCAL_MONGO_HOSTS.has(normalized)) {
    throw new Error(
      `Refusing E2E run: non-local MongoDB host detected in ${envKey}. Only approved local or Docker test hosts are permitted.`,
    );
  }

  return normalized;
}

/**
 * Safely parses and validates a MongoDB connection URI without exposing credentials
 * or full connection strings in thrown errors or logs.
 *
 * Rules:
 * - Rejects missing/empty/malformed URIs.
 * - Rejects all `mongodb+srv://` URIs (Atlas / DNS SRV).
 * - Requires `mongodb://` scheme and validates EVERY host in comma-separated seedlists.
 * - Permits only hosts in APPROVED_LOCAL_MONGO_HOSTS.
 */
export function parseAndAssertSafeLocalMongoUri(
  rawUri,
  envKey = 'MONGODB_URI',
) {
  if (typeof rawUri !== 'string' || rawUri.trim().length === 0) {
    throw new Error(
      `Refusing E2E run: missing or empty MongoDB URI in ${envKey}.`,
    );
  }

  const trimmed = rawUri.trim();
  if (/[\s\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new Error(
      `Refusing E2E run: malformed MongoDB URI in ${envKey} (contains invalid whitespace or control characters).`,
    );
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('mongodb+srv://')) {
    throw new Error(
      `Refusing E2E run: mongodb+srv:// (Atlas/SRV) URI is forbidden in ${envKey}.`,
    );
  }

  if (!lower.startsWith('mongodb://')) {
    throw new Error(
      `Refusing E2E run: malformed or unsupported MongoDB URI scheme in ${envKey}.`,
    );
  }

  const remainder = trimmed.slice('mongodb://'.length);
  const delimiterIdx = remainder.search(/[/?#]/);
  const authority =
    delimiterIdx === -1 ? remainder : remainder.slice(0, delimiterIdx);

  if (!authority) {
    throw new Error(
      `Refusing E2E run: malformed MongoDB URI in ${envKey} (missing authority/host).`,
    );
  }

  // Strip optional userinfo (use last '@' in case an unencoded '@' appeared in password)
  const lastAtIdx = authority.lastIndexOf('@');
  const hostListPart =
    lastAtIdx === -1 ? authority : authority.slice(lastAtIdx + 1);

  if (!hostListPart) {
    throw new Error(
      `Refusing E2E run: malformed MongoDB URI in ${envKey} (missing host after credentials).`,
    );
  }

  const rawEntries = hostListPart.split(',');
  const validatedHosts = [];

  for (const rawEntry of rawEntries) {
    if (!rawEntry || rawEntry.endsWith(':')) {
      throw new Error(
        `Refusing E2E run: malformed MongoDB host entry in ${envKey}.`,
      );
    }

    let parsedHostUrl;
    try {
      parsedHostUrl = new URL(`http://${rawEntry}`);
    } catch {
      throw new Error(
        `Refusing E2E run: malformed MongoDB host or port in ${envKey}.`,
      );
    }

    if (
      parsedHostUrl.username ||
      parsedHostUrl.password ||
      parsedHostUrl.pathname !== '/' ||
      parsedHostUrl.search ||
      parsedHostUrl.hash ||
      !parsedHostUrl.hostname
    ) {
      throw new Error(
        `Refusing E2E run: malformed MongoDB host authority in ${envKey}.`,
      );
    }

    const normalizedHost = normalizeHostToken(parsedHostUrl.hostname);
    if (!APPROVED_LOCAL_MONGO_HOSTS.has(normalizedHost)) {
      throw new Error(
        `Refusing E2E run: non-local MongoDB host detected in ${envKey}. Only approved local or Docker test hosts are permitted.`,
      );
    }

    validatedHosts.push(normalizedHost);
  }

  return {
    envKey,
    hosts: validatedHosts,
  };
}

/**
 * Validates the local E2E HTTP target AND every MongoDB URI / host environment variable
 * present in `env`.
 *
 * When `requireMongoUri` is true, at least one recognized MongoDB URI env var must be set
 * and pass local-only validation.
 */
export function assertSafeLocalE2eEnvironment(
  baseUrl = DEFAULT_E2E_BASE_URL,
  env = process.env,
  { requireMongoUri = false } = {},
) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid E2E_BASE_URL: "${baseUrl}"`);
  }

  if (!APPROVED_LOCAL_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error(
      `Refusing E2E run against non-local host "${parsed.hostname}". Only localhost / 127.0.0.1 targets are permitted.`,
    );
  }

  const uriKeysToInspect = new Set(KNOWN_MONGO_URI_ENV_KEYS);
  for (const key of Object.keys(env || {})) {
    if (/MONGO.*URI/i.test(key)) {
      uriKeysToInspect.add(key);
    }
  }

  let validatedUriCount = 0;
  for (const key of uriKeysToInspect) {
    const val = env?.[key];
    if (val === undefined || val === null) {
      continue;
    }
    if (typeof val === 'string' && val.trim().length === 0) {
      // Empty string is explicitly used in docker-compose.yml (e.g. CORE_MONGODB_URI=)
      // to clear inherited host Atlas URIs; treat as unset unless requireMongoUri demands one.
      continue;
    }
    parseAndAssertSafeLocalMongoUri(val, key);
    validatedUriCount += 1;
  }

  if (requireMongoUri && validatedUriCount === 0) {
    throw new Error(
      'Refusing E2E run: a local MongoDB URI environment variable is required but none was provided.',
    );
  }

  for (const hostKey of KNOWN_MONGO_HOST_ENV_KEYS) {
    const hostVal = env?.[hostKey];
    if (hostVal === undefined || hostVal === null) {
      continue;
    }
    if (typeof hostVal === 'string' && hostVal.trim().length === 0) {
      continue;
    }
    assertSafeLocalMongoHost(hostVal, hostKey);
  }
}

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Pure Node HS256 JWT signer for test-only secrets (negative wrong-secret tests
 * or unit/integration fixture generation matching Core/Planning JWT claims).
 */
export function signTestJwt(
  payload,
  secret,
  {
    issuer = 'gastrowise-auth',
    audience = 'gastrowise-api',
    expiresInSeconds = 3600,
  } = {},
) {
  if (!secret || typeof secret !== 'string') {
    throw new Error('signTestJwt requires a non-empty test-only secret');
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = {
    ...payload,
    iat: nowSec,
    exp: nowSec + expiresInSeconds,
    iss: issuer,
    aud: audience,
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedBody = base64UrlEncode(JSON.stringify(body));
  const signingInput = `${encodedHeader}.${encodedBody}`;
  const signature = createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${signingInput}.${signature}`;
}

export async function httpRequest(
  baseUrl,
  path,
  { method = 'GET', token, headers = {}, body, timeoutMs = 10_000 } = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const reqHeaders = { ...headers };
  if (token) {
    reqHeaders.Authorization = `Bearer ${token}`;
  }
  let serializedBody;
  if (body !== undefined) {
    reqHeaders['Content-Type'] = 'application/json';
    serializedBody = JSON.stringify(body);
  }
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: reqHeaders,
      body: serializedBody,
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, headers: res.headers, text, json };
  } finally {
    clearTimeout(timer);
  }
}

export function dockerExec(container, args) {
  return execFileSync('docker', ['exec', container, ...args], {
    encoding: 'utf8',
    timeout: 20_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Registers an isolated ephemeral test user through the live Nginx Gateway -> Core Auth API
 * and verifies login issuance. Never uses real credentials.
 */
export async function createEphemeralTestUser(baseUrl, label, runId) {
  const safeLabel = String(label).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'user';
  const suffix = `${runId}-${randomBytes(3).toString('hex')}`;
  const email = `e2e-m1012-${safeLabel}-${suffix}@local.gastrowise.test`;
  const username = `e2e_m1012_${safeLabel}_${suffix}`;
  const password = `TestPass!${randomBytes(6).toString('hex')}`;

  const registerRes = await httpRequest(baseUrl, '/api/v1/auth/register', {
    method: 'POST',
    body: { email, username, password },
  });

  if (registerRes.status !== 201 || !registerRes.json?.accessToken) {
    throw new Error(
      `Failed to register ephemeral test user "${email}": HTTP ${registerRes.status} ${registerRes.text}`,
    );
  }

  const loginRes = await httpRequest(baseUrl, '/api/v1/auth/login', {
    method: 'POST',
    body: { email, password },
  });

  if (loginRes.status !== 200 || !loginRes.json?.accessToken) {
    throw new Error(
      `Failed to login ephemeral test user "${email}": HTTP ${loginRes.status} ${loginRes.text}`,
    );
  }

  return {
    id: String(loginRes.json.user?.id || loginRes.json.user?._id),
    email,
    username,
    role: loginRes.json.user?.role || 'user',
    accessToken: loginRes.json.accessToken,
    registerRaw: registerRes.text,
    loginRaw: loginRes.text,
  };
}

/**
 * Fetches deterministic local restaurant candidates already seeded in local gastro_core_test.
 */
export async function fetchLocalRestaurantCandidates(baseUrl) {
  const res = await httpRequest(baseUrl, '/api/v1/restaurants?page=1&limit=10');
  if (res.status !== 200 || !Array.isArray(res.json?.data)) {
    throw new Error(
      `Failed to fetch local restaurant candidates: HTTP ${res.status} ${res.text}`,
    );
  }
  return res.json.data;
}

/**
 * Safely deletes all test-owned itineraries via API and (when Docker checks are enabled)
 * removes ONLY ephemeral `e2e-m1012-*@local.gastrowise.test` user records from local
 * gastro_core_test and any remaining test itineraries from local gastro_planning_test.
 */
export async function cleanupEphemeralTestData({
  baseUrl,
  createdItineraries = [],
  testUsers = [],
  checkDocker = false,
}) {
  const summary = {
    apiDeletedItineraries: 0,
    mongoDeletedUsers: 0,
    mongoDeletedItineraries: 0,
  };

  for (const item of createdItineraries) {
    try {
      const delRes = await httpRequest(
        baseUrl,
        `/api/v1/itineraries/${item.id}`,
        { method: 'DELETE', token: item.ownerToken },
      );
      if (delRes.status === 200) {
        summary.apiDeletedItineraries += 1;
      }
    } catch {
      // Best-effort API cleanup; DB cleanup below handles remaining ephemeral records if enabled.
    }
  }

  if (checkDocker && testUsers.length > 0) {
    const safeEmails = testUsers
      .map((u) => u.email)
      .filter((e) => /^e2e-m1012-[a-z0-9-]+@local\.gastrowise\.test$/.test(e));
    const safeUserIds = testUsers
      .map((u) => u.id)
      .filter((id) => /^[0-9a-fA-F]{24}$/.test(id));

    if (safeEmails.length > 0) {
      const emailJson = JSON.stringify(safeEmails);
      const out = dockerExec('gastrowise-mongo-test', [
        'sh',
        '-c',
        `mongosh --quiet -u "$CORE_DB_USER" -p "$CORE_DB_PASSWORD" --authenticationDatabase "$CORE_DB_NAME" --eval 'const res = db.getSiblingDB(process.env.CORE_DB_NAME || "gastro_core_test").users.deleteMany({ email: { $in: ${emailJson} } }); print(res.deletedCount);'`,
      ]);
      summary.mongoDeletedUsers = Number(out) || 0;
    }

    if (safeUserIds.length > 0) {
      const idJson = JSON.stringify(safeUserIds);
      const out = dockerExec('gastrowise-mongo-test', [
        'sh',
        '-c',
        `mongosh --quiet -u "$PLANNING_DB_USER" -p "$PLANNING_DB_PASSWORD" --authenticationDatabase "$PLANNING_DB_NAME" --eval 'const res = db.getSiblingDB(process.env.PLANNING_DB_NAME || "gastro_planning_test").itineraries.deleteMany({ user_id: { $in: ${idJson} } }); print(res.deletedCount);'`,
      ]);
      summary.mongoDeletedItineraries = Number(out) || 0;
    }
  }

  return summary;
}
