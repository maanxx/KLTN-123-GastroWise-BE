#!/usr/bin/env node
/**
 * GastroWise M10.11 — Reproducible Local End-to-End Backend Smoke Test Suite
 *
 * Strictly local-only:
 * - Refuses non-localhost SMOKE_BASE_URL targets.
 * - Refuses any MongoDB Atlas / remote URI in environment variables.
 * - Performs read-only HTTP & health/isolation assertions (zero DB mutations).
 *
 * Usage:
 *   npm run test:e2e:smoke
 *   SMOKE_CHECK_DOCKER=true npm run test:e2e:smoke
 */

import { execFileSync } from 'node:child_process';

const BASE_URL = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:8080').replace(
  /\/+$/,
  '',
);
const CHECK_DOCKER = process.env.SMOKE_CHECK_DOCKER === 'true';
const REQUEST_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 8000);

const APPROVED_LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function assertSafeLocalSmokeConfig() {
  let parsed;
  try {
    parsed = new URL(BASE_URL);
  } catch {
    throw new Error(`Invalid SMOKE_BASE_URL: "${BASE_URL}"`);
  }

  if (!APPROVED_LOCAL_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error(
      `Refusing smoke test against non-local host "${parsed.hostname}". Only localhost / 127.0.0.1 targets are permitted.`,
    );
  }

  for (const key of ['MONGODB_URI', 'MONGODB_URI_CORE', 'MONGODB_URI_PLANNING']) {
    const val = process.env[key];
    if (
      typeof val === 'string' &&
      (val.includes('mongodb+srv://') || val.toLowerCase().includes('mongodb.net'))
    ) {
      throw new Error(
        `Refusing smoke test while Atlas/remote URI is present in ${key}. Use isolated local Docker env only.`,
      );
    }
  }
}

const results = [];

async function runCheck(flow, name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({
      flow,
      name,
      status: 'PASS',
      durationMs: Date.now() - started,
      detail: detail || 'ok',
    });
  } catch (err) {
    results.push({
      flow,
      name,
      status: 'FAIL',
      durationMs: Date.now() - started,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

function recordSkip(flow, name, reason) {
  results.push({
    flow,
    name,
    status: 'SKIP',
    durationMs: 0,
    detail: reason,
  });
}

async function httpJson(path, { headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'GET',
      headers,
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

function assert(cond, message) {
  if (!cond) {
    throw new Error(message);
  }
}

function dockerExec(container, args) {
  return execFileSync('docker', ['exec', container, ...args], {
    encoding: 'utf8',
    timeout: 15_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

async function main() {
  assertSafeLocalSmokeConfig();
  console.log(`\n[M10.11 E2E Smoke] Target Gateway: ${BASE_URL} | Docker checks: ${CHECK_DOCKER}\n`);

  // =========================================================================
  // FLOW 1 — GATEWAY & HEALTH
  // =========================================================================
  await runCheck('Flow 1: Gateway & Health', 'GET /health via Nginx Gateway', async () => {
    const res = await httpJson('/health');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.json?.status === 'UP', `Unexpected gateway status: ${res.text}`);
    return `HTTP 200 (gateway=${res.json.gateway})`;
  });

  if (CHECK_DOCKER) {
    await runCheck('Flow 1: Gateway & Health', 'Core Service /health/ready (internal 3001)', async () => {
      const raw = dockerExec('gastrowise-core-service', [
        'wget',
        '-qO-',
        'http://127.0.0.1:3001/health/ready',
      ]);
      const data = JSON.parse(raw);
      assert(data.status === 'READY' && data.database?.dbPingOk === true, `Core not ready: ${raw}`);
      return `READY (dbPingOk=true, latencyMs=${data.database.latencyMs})`;
    });

    await runCheck('Flow 1: Gateway & Health', 'Planning Service /health/ready (internal 3003)', async () => {
      const raw = dockerExec('gastrowise-planning-service', [
        'wget',
        '-qO-',
        'http://127.0.0.1:3003/health/ready',
      ]);
      const data = JSON.parse(raw);
      assert(data.status === 'READY' && data.database?.dbPingOk === true, `Planning not ready: ${raw}`);
      return `READY (dbPingOk=true, latencyMs=${data.database.latencyMs})`;
    });

    await runCheck('Flow 1: Gateway & Health', 'AI Service / health (internal 5000)', async () => {
      const raw = dockerExec('gastrowise-ai-service', [
        'curl',
        '-sf',
        'http://127.0.0.1:5000/',
      ]);
      const data = JSON.parse(raw);
      assert(data.data_status === 'DATA_READY', `AI not DATA_READY: ${raw}`);
      assert(
        data.validation?.database === 'gastro_core_test',
        `AI connected to unexpected DB: ${data.validation?.database}`,
      );
      return `DATA_READY (db=${data.validation.database})`;
    });
  } else {
    recordSkip(
      'Flow 1: Gateway & Health',
      'Internal Core/Planning/AI health checks',
      'Internal ports 3001/3003/5000 are not exposed on host; re-run with SMOKE_CHECK_DOCKER=true',
    );
  }

  // =========================================================================
  // FLOW 2 — RESTAURANT & DISH DATA
  // =========================================================================
  let sampleRestaurantId = null;
  let sampleDishId = null;

  await runCheck('Flow 2: Restaurant & Dish', 'GET /api/v1/restaurants?page=1&limit=10', async () => {
    const res = await httpJson('/api/v1/restaurants?page=1&limit=10', {
      headers: { 'X-Correlation-Id': 'm1011-smoke-corr' },
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(res.json?.data), 'Response `data` must be an array');
    assert(
      res.json?.meta &&
        typeof res.json.meta.total === 'number' &&
        res.json.meta.page === 1 &&
        res.json.meta.limit === 10,
      `Invalid pagination meta: ${JSON.stringify(res.json?.meta)}`,
    );
    const corrHeader = res.headers.get('x-correlation-id');
    assert(corrHeader === 'm1011-smoke-corr', `Unexpected X-Correlation-Id: ${corrHeader}`);
    assert(
      !res.text.includes('ingestionBatchId') && !res.text.includes('ingestionPostDigest'),
      'Internal ingestion fields leaked in public restaurants response',
    );
    if (res.json.data.length > 0) {
      sampleRestaurantId = res.json.data[0].id;
    }
    return `HTTP 200 (total=${res.json.meta.total}, returned=${res.json.data.length})`;
  });

  if (sampleRestaurantId) {
    await runCheck('Flow 2: Restaurant & Dish', `GET /api/v1/restaurants/${sampleRestaurantId}`, async () => {
      const res = await httpJson(`/api/v1/restaurants/${sampleRestaurantId}`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.json?.id === sampleRestaurantId, 'Returned restaurant ID mismatch');
      return `HTTP 200 (${res.json.tenQuan})`;
    });

    await runCheck('Flow 2: Restaurant & Dish', `GET /api/v1/restaurants/${sampleRestaurantId}/dishes`, async () => {
      const res = await httpJson(`/api/v1/restaurants/${sampleRestaurantId}/dishes?page=1&limit=10`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(Array.isArray(res.json?.data), 'Response `data` must be an array');
      assert(
        res.json.data.every((d) => d.restaurantId === sampleRestaurantId),
        'Cross-restaurant dish leakage detected',
      );
      return `HTTP 200 (total=${res.json.meta?.total}, scoped=true)`;
    });
  } else {
    recordSkip(
      'Flow 2: Restaurant & Dish',
      'Restaurant detail & restaurant dishes',
      'No restaurants present in local gastro_core_test database',
    );
  }

  await runCheck('Flow 2: Restaurant & Dish', 'GET /api/v1/dishes?page=1&limit=10&sortBy=price&order=asc', async () => {
    const res = await httpJson('/api/v1/dishes?page=1&limit=10&sortBy=price&order=asc');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(res.json?.data), 'Response `data` must be an array');
    assert(res.json?.meta && typeof res.json.meta.total === 'number', 'Missing pagination meta');
    for (let i = 1; i < res.json.data.length; i += 1) {
      assert(
        res.json.data[i].price >= res.json.data[i - 1].price,
        'Dishes are not sorted ascending by price',
      );
    }
    assert(
      !res.text.includes('sourceMetadata') && !res.text.includes('externalSourceId'),
      'Internal dish provenance leaked in public dishes response',
    );
    if (res.json.data.length > 0) {
      sampleDishId = res.json.data[0].id;
    }
    return `HTTP 200 (total=${res.json.meta.total}, sortedAsc=true)`;
  });

  if (sampleDishId) {
    await runCheck('Flow 2: Restaurant & Dish', `GET /api/v1/dishes/${sampleDishId}`, async () => {
      const res = await httpJson(`/api/v1/dishes/${sampleDishId}`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.json?.id === sampleDishId, 'Returned dish ID mismatch');
      return `HTTP 200 (${res.json.name}, ${res.json.price} VND)`;
    });
  }

  await runCheck('Flow 2: Restaurant & Dish', 'GET /dishes?page=1&limit=2 (Gateway rewrite)', async () => {
    const res = await httpJson('/dishes?page=1&limit=2');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.json?.meta?.limit === 2, `Query param limit not forwarded: ${res.text}`);
    return `HTTP 200 (limit=2, total=${res.json.meta.total})`;
  });

  // =========================================================================
  // FLOW 3 — FOOD RECOMMENDATION
  // =========================================================================
  await runCheck('Flow 3: Food Recommendation', 'Keyword + location + radius + maxBudget', async () => {
    const res = await httpJson(
      '/api/v1/recommendations/food?keyword=Ph%E1%BB%9F&latitude=10.785&longitude=106.688&radiusKm=5&maxBudget=100000',
    );
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(res.json?.data), 'Expected data array');
    assert(
      res.json?.meta?.strategy === 'hybrid' || res.json?.meta?.strategy === 'deterministic',
      `Unexpected strategy: ${res.json?.meta?.strategy}`,
    );
    assert(!res.text.includes('sourceMetadata'), 'sourceMetadata leaked in recommendation response');
    for (const item of res.json.data) {
      assert(Boolean(item.restaurant?.id), 'Missing restaurant.id in recommendation item');
      assert(Array.isArray(item.reasons) && item.reasons.length > 0, 'Missing reasons');
      for (const dish of item.recommendedDishes || []) {
        assert(dish.restaurant === undefined, 'Bogus nested restaurant stub present on recommendedDish');
        assert(dish.price <= 100000, `Dish price ${dish.price} exceeded maxBudget`);
      }
    }
    return `HTTP 200 (strategy=${res.json.meta.strategy}, matches=${res.json.data.length})`;
  });

  await runCheck('Flow 3: Food Recommendation', 'Vegetarian + maxBudget filter', async () => {
    const res = await httpJson('/api/v1/recommendations/food?isVegetarian=true&maxBudget=60000');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    for (const item of res.json.data) {
      assert(item.recommendedDishes.length > 0, 'Vegetarian recommendation returned 0 dishes');
      for (const dish of item.recommendedDishes) {
        assert(dish.isVegetarian === true, `Non-vegetarian dish returned: ${dish.name}`);
        assert(dish.price <= 60000, `Dish price ${dish.price} exceeded 60000`);
      }
    }
    return `HTTP 200 (matches=${res.json.data.length})`;
  });

  await runCheck('Flow 3: Food Recommendation', 'Invalid inputs rejected with HTTP 400', async () => {
    const cases = [
      '/api/v1/recommendations/food?latitude=0&longitude=0',
      '/api/v1/recommendations/food?minBudget=100000&maxBudget=50000',
      '/api/v1/recommendations/food?maxBudget=99000000',
      '/api/v1/recommendations/food?limit=99',
    ];
    for (const path of cases) {
      const res = await httpJson(path);
      assert(res.status === 400, `Expected 400 for ${path}, got ${res.status}`);
    }
    return `All ${cases.length} invalid queries returned HTTP 400`;
  });

  // =========================================================================
  // FLOW 4 — PLANNING INTEGRATION & DB ISOLATION
  // =========================================================================
  await runCheck('Flow 4: Planning Integration', 'Gateway -> Planning GET /api/v1/itineraries (unauth 401)', async () => {
    const res = await httpJson('/api/v1/itineraries');
    assert(res.status === 401, `Expected 401, got ${res.status}`);
    return 'HTTP 401 (routed to planning-service, JWT guard active)';
  });

  if (CHECK_DOCKER) {
    await runCheck(
      'Flow 4: Planning Integration',
      'Planning -> Core internal API auth (noKey=401, badKey=401, validKey=200)',
      async () => {
        const script = `
          const http = require("http");
          const req = (u, h = {}) => new Promise((res, rej) =>
            http.get(u, { headers: h }, (r) => {
              let b = "";
              r.on("data", (c) => b += c);
              r.on("end", () => res({ status: r.statusCode, body: b }));
            }).on("error", rej)
          );
          (async () => {
            const url = "http://core-service:3001/api/v1/internal/restaurants/candidates?limit=5";
            const noKey = await req(url);
            const badKey = await req(url, { "X-Internal-Service-Key": "wrong-key" });
            const goodKey = await req(url, { "X-Internal-Service-Key": process.env.INTERNAL_SERVICE_KEY });
            console.log(JSON.stringify({ noKey: noKey.status, badKey: badKey.status, goodKey: goodKey.status, total: JSON.parse(goodKey.body).total }));
          })();
        `;
        const raw = dockerExec('gastrowise-planning-service', ['node', '-e', script]);
        const out = JSON.parse(raw);
        assert(out.noKey === 401 && out.badKey === 401 && out.goodKey === 200, `Unexpected auth matrix: ${raw}`);
        return `noKey=401, badKey=401, validKey=200 (candidates=${out.total})`;
      },
    );

    await runCheck(
      'Flow 4: Planning Integration',
      'Bidirectional MongoDB SCRAM DB isolation (Core <-> Planning)',
      async () => {
        const coreToPlanning = dockerExec('gastrowise-mongo-test', [
          'sh',
          '-c',
          'mongosh --quiet -u "$CORE_DB_USER" -p "$CORE_DB_PASSWORD" --authenticationDatabase "$CORE_DB_NAME" --eval "try { db.getSiblingDB(process.env.PLANNING_DB_NAME || \\"gastro_planning_test\\").getCollectionNames(); print(\\"BREACH\\"); } catch (e) { print(e.codeName); }"',
        ]);
        const planningToCore = dockerExec('gastrowise-mongo-test', [
          'sh',
          '-c',
          'mongosh --quiet -u "$PLANNING_DB_USER" -p "$PLANNING_DB_PASSWORD" --authenticationDatabase "$PLANNING_DB_NAME" --eval "try { db.getSiblingDB(process.env.CORE_DB_NAME || \\"gastro_core_test\\").getCollectionNames(); print(\\"BREACH\\"); } catch (e) { print(e.codeName); }"',
        ]);
        assert(coreToPlanning === 'Unauthorized', `Core->Planning isolation failed: ${coreToPlanning}`);
        assert(planningToCore === 'Unauthorized', `Planning->Core isolation failed: ${planningToCore}`);
        return 'Core->Planning=Unauthorized, Planning->Core=Unauthorized';
      },
    );
  } else {
    recordSkip(
      'Flow 4: Planning Integration',
      'Internal Core-Planning auth & MongoDB DB isolation',
      'Re-run with SMOKE_CHECK_DOCKER=true to verify inside Docker network',
    );
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  let passCount = 0;
  let failCount = 0;
  let skipCount = 0;

  for (const r of results) {
    if (r.status === 'PASS') passCount += 1;
    else if (r.status === 'FAIL') failCount += 1;
    else skipCount += 1;
    console.log(`[${r.status.padEnd(4)}] (${r.durationMs}ms) ${r.flow} :: ${r.name} -> ${r.detail}`);
  }

  console.log(`\nSummary: ${passCount} PASS, ${failCount} FAIL, ${skipCount} SKIP (Total: ${results.length})\n`);
  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[FAIL] Fatal smoke-test error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
