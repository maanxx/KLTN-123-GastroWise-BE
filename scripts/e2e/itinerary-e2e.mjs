#!/usr/bin/env node
/**
 * GastroWise M10.12 — Full Authenticated Itinerary Lifecycle E2E Suite
 *
 * Executes the real business workflow through Nginx API Gateway:
 *   User Auth -> Preferences -> Core Candidate Retrieval -> AI Route Optimization ->
 *   Itinerary Persistence -> Retrieval -> Mutations -> Ownership Isolation -> Deletion & Cleanup
 *
 * Usage:
 *   npm run test:e2e:itinerary
 *   E2E_CHECK_DOCKER=true npm run test:e2e:itinerary
 */

import { randomBytes } from 'node:crypto';
import {
  DEFAULT_E2E_BASE_URL,
  assertSafeLocalE2eEnvironment,
  cleanupEphemeralTestData,
  createEphemeralTestUser,
  dockerExec,
  fetchLocalRestaurantCandidates,
  httpRequest,
  signTestJwt,
} from './fixtures/itinerary-e2e.fixtures.mjs';

const BASE_URL = (process.env.E2E_BASE_URL || DEFAULT_E2E_BASE_URL).replace(
  /\/+$/,
  '',
);
const CHECK_DOCKER = process.env.E2E_CHECK_DOCKER === 'true';

const results = [];
const capturedResponses = [];

function assert(cond, message) {
  if (!cond) {
    throw new Error(message);
  }
}

async function runCheck(stage, name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({
      stage,
      name,
      status: 'PASS',
      durationMs: Date.now() - started,
      detail: detail || 'ok',
    });
  } catch (err) {
    results.push({
      stage,
      name,
      status: 'FAIL',
      durationMs: Date.now() - started,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

function recordSkip(stage, name, reason) {
  results.push({
    stage,
    name,
    status: 'SKIP',
    durationMs: 0,
    detail: reason,
  });
}

async function main() {
  assertSafeLocalE2eEnvironment(BASE_URL);
  const runId = `${Date.now().toString(36)}-${randomBytes(2).toString('hex')}`;
  console.log(
    `\n[M10.12 Authenticated Itinerary E2E] Gateway: ${BASE_URL} | Docker checks: ${CHECK_DOCKER} | Run: ${runId}\n`,
  );

  const testUsers = [];
  const createdItineraries = [];

  let userA = null;
  let userB = null;
  let localCandidates = [];
  let itineraryId = null;
  let generatedStops = [];
  let addedStopId = null;

  try {
    // =========================================================================
    // STAGE 1 — AUTHENTICATION & JWT SECURITY GUARDS
    // =========================================================================
    await runCheck('Stage 1: Auth', 'Reject unauthenticated GET /api/v1/itineraries (401)', async () => {
      const res = await httpRequest(BASE_URL, '/api/v1/itineraries');
      capturedResponses.push(res.text);
      assert(res.status === 401, `Expected 401, got ${res.status}`);
      return 'HTTP 401 Unauthorized';
    });

    await runCheck('Stage 1: Auth', 'Reject wrong-secret test JWT on GET /api/v1/itineraries (401)', async () => {
      const invalidJwt = signTestJwt(
        { sub: '674000000000000000000001', email: 'forged@local.gastrowise.test', role: 'user' },
        'wrong-test-only-jwt-secret-must-fail',
      );
      const res = await httpRequest(BASE_URL, '/api/v1/itineraries', {
        token: invalidJwt,
      });
      capturedResponses.push(res.text);
      assert(res.status === 401, `Expected 401 for invalid JWT, got ${res.status}`);
      return 'HTTP 401 Unauthorized (invalid signature rejected)';
    });

    await runCheck('Stage 1: Auth', 'Register & login ephemeral User A via Nginx -> Core Auth', async () => {
      userA = await createEphemeralTestUser(BASE_URL, 'usera', runId);
      testUsers.push(userA);
      capturedResponses.push(userA.registerRaw, userA.loginRaw);
      assert(
        !userA.registerRaw.includes('hashedRefreshToken') &&
          !userA.loginRaw.includes('"password"'),
        'Sensitive auth fields leaked in register/login response',
      );
      return `User A authenticated (id=${userA.id})`;
    });

    await runCheck('Stage 1: Auth', 'Register & login ephemeral User B via Nginx -> Core Auth', async () => {
      userB = await createEphemeralTestUser(BASE_URL, 'userb', runId);
      testUsers.push(userB);
      capturedResponses.push(userB.registerRaw, userB.loginRaw);
      assert(userB.id !== userA.id, 'User A and User B must have distinct IDs');
      return `User B authenticated (id=${userB.id})`;
    });

    await runCheck('Stage 1: Auth', 'Load deterministic local restaurant candidates via Gateway', async () => {
      localCandidates = await fetchLocalRestaurantCandidates(BASE_URL);
      assert(
        localCandidates.length >= 2,
        `Expected >= 2 local restaurants in gastro_core_test, found ${localCandidates.length}`,
      );
      return `Found ${localCandidates.length} local restaurants (${localCandidates.map((r) => r.tenQuan).join(', ')})`;
    });

    // =========================================================================
    // STAGE 2 — VALIDATION, INTERNAL AUTH & DB ISOLATION
    // =========================================================================
    await runCheck('Stage 2: Validation & Mesh', 'Reject missing required fields on POST /api/v1/itineraries/generate (400)', async () => {
      const res = await httpRequest(BASE_URL, '/api/v1/itineraries/generate', {
        method: 'POST',
        token: userA.accessToken,
        body: {},
      });
      capturedResponses.push(res.text);
      assert(res.status === 400, `Expected 400, got ${res.status}: ${res.text}`);
      return 'HTTP 400 Bad Request';
    });

    await runCheck('Stage 2: Validation & Mesh', 'Reject [0, 0] starting coordinates on POST /api/v1/itineraries/generate (400)', async () => {
      const res = await httpRequest(BASE_URL, '/api/v1/itineraries/generate', {
        method: 'POST',
        token: userA.accessToken,
        body: {
          prompt: 'Food tour phở Sài Gòn',
          start_time: '11:00',
          end_time: '14:30',
          lat: 0,
          lng: 0,
          budget: 250000,
        },
      });
      capturedResponses.push(res.text);
      assert(res.status === 400, `Expected 400 for [0,0], got ${res.status}: ${res.text}`);
      return 'HTTP 400 Bad Request ([0,0] rejected)';
    });

    if (CHECK_DOCKER) {
      await runCheck(
        'Stage 2: Validation & Mesh',
        'Verify Planning -> Core internal candidate auth (noKey=401, badKey=401, validKey=200)',
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
              const url = "http://core-service:3001/api/v1/internal/restaurants/candidates?lat=10.78&lng=106.69&radius_km=15&limit=15";
              const noKey = await req(url);
              const badKey = await req(url, { "X-Internal-Service-Key": "invalid-test-key" });
              const goodKey = await req(url, { "X-Internal-Service-Key": process.env.INTERNAL_SERVICE_KEY });
              console.log(JSON.stringify({ noKey: noKey.status, badKey: badKey.status, goodKey: goodKey.status, total: JSON.parse(goodKey.body).total }));
            })();
          `;
          const out = JSON.parse(
            dockerExec('gastrowise-planning-service', ['node', '-e', script]),
          );
          assert(
            out.noKey === 401 && out.badKey === 401 && out.goodKey === 200 && out.total >= 2,
            `Unexpected Core internal auth result: ${JSON.stringify(out)}`,
          );
          return `noKey=401, badKey=401, validKey=200 (candidates=${out.total})`;
        },
      );

      await runCheck(
        'Stage 2: Validation & Mesh',
        'Verify Planning -> AI /routes/optimize auth & canonical contract (noKey=401, badKey=403, validKey=200)',
        async () => {
          const script = `
            const http = require("http");
            const post = (u, payload, h = {}) => new Promise((res, rej) => {
              const data = JSON.stringify(payload);
              const req = http.request(u, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), ...h } }, (r) => {
                let b = "";
                r.on("data", (c) => b += c);
                r.on("end", () => res({ status: r.statusCode, body: b }));
              });
              req.on("error", rej);
              req.write(data);
              req.end();
            });
            (async () => {
              const url = "http://ai-service:5000/routes/optimize";
              const payload = {
                start_location: [10.7769, 106.7009],
                start_time_mins: 660,
                budget: 250000,
                routing_mode: "motorbike",
                desired_stops: 2,
                candidates: [
                  { id: "c1", name: "Pho Hoa", lat: 10.7852, lon: 106.6879, meal_type: "main", open_time: "06:00", close_time: "22:00", dining_duration_mins: 45, avg_price: 75000, rating: 4.5 },
                  { id: "c2", name: "Banh Mi", lat: 10.7722, lon: 106.6921, meal_type: "starter", open_time: "08:00", close_time: "22:00", dining_duration_mins: 45, avg_price: 65000, rating: 4.7 }
                ]
              };
              const noKey = await post(url, payload);
              const badKey = await post(url, payload, { "X-Internal-AI-Key": "wrong-ai-key" });
              const goodKey = await post(url, payload, { "X-Internal-AI-Key": process.env.INTERNAL_AI_KEY });
              const parsed = JSON.parse(goodKey.body);
              console.log(JSON.stringify({ noKey: noKey.status, badKey: badKey.status, goodKey: goodKey.status, stops: parsed.stops?.length, solver: parsed.algorithm_used }));
            })();
          `;
          const out = JSON.parse(
            dockerExec('gastrowise-planning-service', ['node', '-e', script]),
          );
          assert(
            out.noKey === 401 && out.badKey === 403 && out.goodKey === 200 && out.stops >= 2,
            `Unexpected AI optimize auth/contract result: ${JSON.stringify(out)}`,
          );
          return `noKey=401, badKey=403, validKey=200 (solver=${out.solver}, stops=${out.stops})`;
        },
      );

      await runCheck(
        'Stage 2: Validation & Mesh',
        'Verify bidirectional MongoDB SCRAM DB isolation (Core <-> Planning)',
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
          assert(coreToPlanning === 'Unauthorized', `Core->Planning breach: ${coreToPlanning}`);
          assert(planningToCore === 'Unauthorized', `Planning->Core breach: ${planningToCore}`);
          return 'Core->Planning=Unauthorized, Planning->Core=Unauthorized';
        },
      );
    } else {
      recordSkip(
        'Stage 2: Validation & Mesh',
        'Internal Core/AI mesh auth & MongoDB isolation checks',
        'Re-run with E2E_CHECK_DOCKER=true to verify inside Docker network',
      );
    }

    // =========================================================================
    // STAGE 3 — ITINERARY GENERATION, PERSISTENCE & SNAPSHOT INTEGRITY
    // =========================================================================
    await runCheck(
      'Stage 3: Generate & Persist',
      'POST /api/v1/itineraries/generate as User A through Nginx Gateway',
      async () => {
        const res = await httpRequest(BASE_URL, '/api/v1/itineraries/generate', {
          method: 'POST',
          token: userA.accessToken,
          headers: { 'X-Correlation-Id': `m1012-${runId}` },
          body: {
            prompt: 'Food tour ẩm thực Sài Gòn ngon bổ rẻ',
            start_time: '11:00',
            end_time: '15:00',
            lat: 10.7769,
            lng: 106.7009,
            budget: 300000,
            desired_stops: 2,
            routing_mode: 'motorbike',
          },
        });
        capturedResponses.push(res.text);
        assert(res.status === 201, `Expected 201, got ${res.status}: ${res.text}`);
        const doc = res.json;
        itineraryId = String(doc._id || doc.id);
        createdItineraries.push({ id: itineraryId, ownerToken: userA.accessToken });

        assert(doc.user_id === userA.id, `Expected user_id=${userA.id}, got ${doc.user_id}`);
        assert(doc.status === 'generated', `Expected status=generated, got ${doc.status}`);
        assert(Array.isArray(doc.stops) && doc.stops.length >= 2, `Expected >= 2 stops, got ${doc.stops?.length}`);
        assert(
          doc.stops.every((s, idx) => s.order_index === idx + 1),
          `Expected 1-based canonical order_index, got ${JSON.stringify(doc.stops.map((s) => s.order_index))}`,
        );
        for (const stop of doc.stops) {
          assert(typeof stop.stop_id === 'string' && stop.stop_id.length > 0, 'Missing stop_id');
          assert(typeof stop.restaurant_id === 'string' && stop.restaurant_id.length > 0, 'Missing restaurant_id snapshot');
          assert(typeof stop.restaurant_name === 'string' && stop.restaurant_name.length > 0, 'Missing restaurant_name snapshot');
          assert(typeof stop.restaurant_lat === 'number' && stop.restaurant_lat !== 0, 'Missing restaurant_lat snapshot');
          assert(typeof stop.restaurant_lng === 'number' && stop.restaurant_lng !== 0, 'Missing restaurant_lng snapshot');
          assert(typeof stop.restaurant_address === 'string' && stop.restaurant_address.length > 0, 'Missing restaurant_address snapshot');
          assert(typeof stop.restaurant_rating === 'number', 'Missing restaurant_rating snapshot');
          assert(typeof stop.arrival_time === 'string' && /^\d{2}:\d{2}$/.test(stop.arrival_time), `Invalid arrival_time: ${stop.arrival_time}`);
          assert(typeof stop.departure_time === 'string' && /^\d{2}:\d{2}$/.test(stop.departure_time), `Invalid departure_time: ${stop.departure_time}`);
        }
        generatedStops = doc.stops;
        const corr = res.headers.get('x-correlation-id');
        assert(corr === `m1012-${runId}`, `Unexpected X-Correlation-Id: ${corr}`);
        return `HTTP 201 (id=${itineraryId}, stops=${doc.stops.length}, solver=${doc.optimizedBy}, cost=${doc.total_cost} VND)`;
      },
    );

    await runCheck('Stage 3: Generate & Persist', 'GET /api/v1/itineraries returns persisted itinerary for User A', async () => {
      const res = await httpRequest(BASE_URL, '/api/v1/itineraries', {
        token: userA.accessToken,
      });
      capturedResponses.push(res.text);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(Array.isArray(res.json), 'Expected array response');
      const found = res.json.find((item) => String(item._id || item.id) === itineraryId);
      assert(Boolean(found), `Generated itinerary ${itineraryId} not found in User A list`);
      return `HTTP 200 (count=${res.json.length}, persisted=true)`;
    });

    await runCheck('Stage 3: Generate & Persist', 'GET /api/v1/itineraries/:id returns exact itinerary & snapshots for owner', async () => {
      const res = await httpRequest(BASE_URL, `/api/v1/itineraries/${itineraryId}`, {
        token: userA.accessToken,
      });
      capturedResponses.push(res.text);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(String(res.json._id || res.json.id) === itineraryId, 'Itinerary ID mismatch');
      assert(res.json.user_id === userA.id, 'Owner mismatch');
      assert(res.json.stops.length === generatedStops.length, 'Stop count mismatch');
      return `HTTP 200 (owner=${userA.id}, snapshots=${res.json.stops.length})`;
    });

    if (CHECK_DOCKER && itineraryId) {
      await runCheck(
        'Stage 3: Generate & Persist',
        'Verify Planning DB owns itinerary record (present in gastro_planning_test, absent in gastro_core_test)',
        async () => {
          const planningCount = dockerExec('gastrowise-mongo-test', [
            'sh',
            '-c',
            `mongosh --quiet -u "$PLANNING_DB_USER" -p "$PLANNING_DB_PASSWORD" --authenticationDatabase "$PLANNING_DB_NAME" --eval 'print(db.getSiblingDB(process.env.PLANNING_DB_NAME || "gastro_planning_test").itineraries.countDocuments({ _id: ObjectId("${itineraryId}") }))'`,
          ]);
          const coreCount = dockerExec('gastrowise-mongo-test', [
            'sh',
            '-c',
            `mongosh --quiet -u "$CORE_DB_USER" -p "$CORE_DB_PASSWORD" --authenticationDatabase "$CORE_DB_NAME" --eval 'print(db.getSiblingDB(process.env.CORE_DB_NAME || "gastro_core_test").itineraries.countDocuments({ _id: ObjectId("${itineraryId}") }))'`,
          ]);
          assert(planningCount === '1', `Expected itinerary in gastro_planning_test, got ${planningCount}`);
          assert(coreCount === '0', `Unexpected itinerary in gastro_core_test: ${coreCount}`);
          return 'gastro_planning_test=1, gastro_core_test=0';
        },
      );
    }

    // =========================================================================
    // STAGE 4 — ITINERARY MUTATIONS (REORDER, RECALCULATE, ADD/REMOVE STOP, STATUS)
    // =========================================================================
    await runCheck('Stage 4: Mutations', 'PATCH /api/v1/itineraries/:id/reorder reverses stop order & recalculates', async () => {
      const reversedIds = [...generatedStops].reverse().map((s) => s.stop_id);
      const res = await httpRequest(BASE_URL, `/api/v1/itineraries/${itineraryId}/reorder`, {
        method: 'PATCH',
        token: userA.accessToken,
        body: { stop_ids: reversedIds },
      });
      capturedResponses.push(res.text);
      assert(res.status === 200, `Expected 200, got ${res.status}: ${res.text}`);
      const newIds = res.json.stops.map((s) => s.stop_id);
      assert(
        JSON.stringify(newIds) === JSON.stringify(reversedIds),
        `Expected reordered stops ${JSON.stringify(reversedIds)}, got ${JSON.stringify(newIds)}`,
      );
      assert(
        res.json.stops.every((s) => typeof s.restaurant_address === 'string' && s.restaurant_address.length > 0),
        'Snapshot restaurant_address was lost during reorder',
      );
      return `HTTP 200 (order reversed, snapshot metadata preserved)`;
    });

    await runCheck('Stage 4: Mutations', 'POST /api/v1/itineraries/:id/recalculate updates budget, mode & timetable', async () => {
      const res = await httpRequest(BASE_URL, `/api/v1/itineraries/${itineraryId}/recalculate`, {
        method: 'POST',
        token: userA.accessToken,
        body: { budget: 400000, routing_mode: 'car', start_time: '12:00' },
      });
      capturedResponses.push(res.text);
      assert(res.status === 201 || res.status === 200, `Expected 200/201, got ${res.status}: ${res.text}`);
      assert(res.json.budget === 400000, `Expected budget=400000, got ${res.json.budget}`);
      assert(res.json.routing_mode === 'car', `Expected routing_mode=car, got ${res.json.routing_mode}`);
      assert(res.json.start_time === '12:00', `Expected start_time=12:00, got ${res.json.start_time}`);
      return `HTTP ${res.status} (budget=400000, mode=car, start=12:00)`;
    });

    await runCheck('Stage 4: Mutations', 'POST /api/v1/itineraries/:id/stops fetches Core snapshot & adds stop', async () => {
      const existingRestIds = new Set(generatedStops.map((s) => s.restaurant_id));
      const candidateToAdd =
        localCandidates.find((r) => !existingRestIds.has(r.id)) || localCandidates[0];
      const beforeCount = generatedStops.length;
      const res = await httpRequest(BASE_URL, `/api/v1/itineraries/${itineraryId}/stops`, {
        method: 'POST',
        token: userA.accessToken,
        body: { restaurant_id: candidateToAdd.id },
      });
      capturedResponses.push(res.text);
      assert(res.status === 201 || res.status === 200, `Expected 200/201, got ${res.status}: ${res.text}`);
      assert(res.json.stops.length === beforeCount + 1, `Expected ${beforeCount + 1} stops, got ${res.json.stops.length}`);
      addedStopId = res.json.stops[res.json.stops.length - 1].stop_id;
      return `HTTP ${res.status} (added=${candidateToAdd.tenQuan}, totalStops=${res.json.stops.length})`;
    });

    await runCheck('Stage 4: Mutations', 'DELETE /api/v1/itineraries/:id/stops/:stopId removes added stop', async () => {
      const res = await httpRequest(
        BASE_URL,
        `/api/v1/itineraries/${itineraryId}/stops/${addedStopId}`,
        { method: 'DELETE', token: userA.accessToken },
      );
      capturedResponses.push(res.text);
      assert(res.status === 200, `Expected 200, got ${res.status}: ${res.text}`);
      assert(res.json.stops.length === generatedStops.length, `Expected ${generatedStops.length} stops after removal`);
      return `HTTP 200 (removed=${addedStopId}, totalStops=${res.json.stops.length})`;
    });

    await runCheck('Stage 4: Mutations', 'PATCH /api/v1/itineraries/:id updates status to confirmed with audit trail', async () => {
      const res = await httpRequest(BASE_URL, `/api/v1/itineraries/${itineraryId}`, {
        method: 'PATCH',
        token: userA.accessToken,
        body: { status: 'confirmed' },
      });
      capturedResponses.push(res.text);
      assert(res.status === 200, `Expected 200, got ${res.status}: ${res.text}`);
      assert(res.json.status === 'confirmed', `Expected status=confirmed, got ${res.json.status}`);
      assert(res.json.confirmedBy === userA.id, `Expected confirmedBy=${userA.id}, got ${res.json.confirmedBy}`);
      assert(Boolean(res.json.confirmedAt), 'Missing confirmedAt timestamp');
      return `HTTP 200 (status=confirmed, confirmedBy=${res.json.confirmedBy})`;
    });

    // =========================================================================
    // STAGE 5 — CROSS-USER OWNERSHIP ISOLATION & 404 CHECKS
    // =========================================================================
    await runCheck('Stage 5: Ownership & AuthZ', 'User B cannot see User A itinerary in GET /api/v1/itineraries', async () => {
      const res = await httpRequest(BASE_URL, '/api/v1/itineraries', {
        token: userB.accessToken,
      });
      capturedResponses.push(res.text);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(Array.isArray(res.json) && res.json.length === 0, `Expected empty list for User B, got ${res.json?.length}`);
      return 'HTTP 200 (User B list isolated: 0 items)';
    });

    await runCheck('Stage 5: Ownership & AuthZ', 'User B is denied read/update/reorder/recalculate/stops/delete on User A itinerary (all 403)', async () => {
      const firstStopId = generatedStops[0].stop_id;
      const attempts = [
        { label: 'GET :id', method: 'GET', path: `/api/v1/itineraries/${itineraryId}` },
        { label: 'PATCH :id', method: 'PATCH', path: `/api/v1/itineraries/${itineraryId}`, body: { status: 'cancelled' } },
        { label: 'PATCH :id/reorder', method: 'PATCH', path: `/api/v1/itineraries/${itineraryId}/reorder`, body: { stop_ids: [firstStopId] } },
        { label: 'POST :id/recalculate', method: 'POST', path: `/api/v1/itineraries/${itineraryId}/recalculate`, body: { budget: 100000 } },
        { label: 'POST :id/stops', method: 'POST', path: `/api/v1/itineraries/${itineraryId}/stops`, body: { restaurant_id: localCandidates[0].id } },
        { label: 'DELETE :id/stops/:stopId', method: 'DELETE', path: `/api/v1/itineraries/${itineraryId}/stops/${firstStopId}` },
        { label: 'DELETE :id', method: 'DELETE', path: `/api/v1/itineraries/${itineraryId}` },
      ];
      for (const a of attempts) {
        const res = await httpRequest(BASE_URL, a.path, {
          method: a.method,
          token: userB.accessToken,
          body: a.body,
        });
        capturedResponses.push(res.text);
        assert(res.status === 403, `Expected 403 for User B ${a.label}, got ${res.status}: ${res.text}`);
      }
      return `All ${attempts.length} cross-user operations denied with HTTP 403`;
    });

    await runCheck('Stage 5: Ownership & AuthZ', 'Non-admin User A is denied GET /api/v1/itineraries/all (403)', async () => {
      const res = await httpRequest(BASE_URL, '/api/v1/itineraries/all', {
        token: userA.accessToken,
      });
      capturedResponses.push(res.text);
      assert(res.status === 403, `Expected 403 for non-admin /all, got ${res.status}`);
      return 'HTTP 403 Forbidden (admin RBAC enforced)';
    });

    await runCheck('Stage 5: Ownership & AuthZ', 'Missing itinerary ID returns HTTP 404', async () => {
      const res = await httpRequest(
        BASE_URL,
        '/api/v1/itineraries/674000000000000000000099',
        { token: userA.accessToken },
      );
      capturedResponses.push(res.text);
      assert(res.status === 404, `Expected 404, got ${res.status}`);
      return 'HTTP 404 Not Found';
    });

    // =========================================================================
    // STAGE 6 — DELETION, SECURITY LEAK AUDIT & CLEANUP
    // =========================================================================
    await runCheck('Stage 6: Delete & Audit', 'Owner DELETE /api/v1/itineraries/:id deletes itinerary & subsequent GET returns 404', async () => {
      const delRes = await httpRequest(BASE_URL, `/api/v1/itineraries/${itineraryId}`, {
        method: 'DELETE',
        token: userA.accessToken,
      });
      capturedResponses.push(delRes.text);
      assert(delRes.status === 200, `Expected 200 on DELETE, got ${delRes.status}`);

      const getRes = await httpRequest(BASE_URL, `/api/v1/itineraries/${itineraryId}`, {
        token: userA.accessToken,
      });
      capturedResponses.push(getRes.text);
      assert(getRes.status === 404, `Expected 404 after DELETE, got ${getRes.status}`);
      return 'HTTP 200 deleted -> subsequent GET returned HTTP 404';
    });

    await runCheck('Stage 6: Delete & Audit', 'Zero sensitive credentials/secrets leaked in API responses', async () => {
      const forbiddenNeedles = [
        'mongodb+srv://',
        'INTERNAL_SERVICE_KEY',
        'INTERNAL_AI_KEY',
        'JWT_SECRET',
        'hashedRefreshToken',
        'twoFactorSecret',
      ];
      const joined = capturedResponses.join('\n');
      for (const needle of forbiddenNeedles) {
        assert(!joined.includes(needle), `Sensitive pattern "${needle}" leaked in API response`);
      }
      return `Scanned ${capturedResponses.length} API responses (0 leaks)`;
    });
  } finally {
    const cleanup = await cleanupEphemeralTestData({
      baseUrl: BASE_URL,
      createdItineraries,
      testUsers,
      checkDocker: CHECK_DOCKER,
    });
    results.push({
      stage: 'Stage 6: Delete & Audit',
      name: 'Cleanup ephemeral test records',
      status: 'PASS',
      durationMs: 0,
      detail: `apiDeletedItineraries=${cleanup.apiDeletedItineraries}, mongoDeletedUsers=${cleanup.mongoDeletedUsers}, mongoDeletedItineraries=${cleanup.mongoDeletedItineraries}`,
    });
  }

  let passCount = 0;
  let failCount = 0;
  let skipCount = 0;

  for (const r of results) {
    if (r.status === 'PASS') passCount += 1;
    else if (r.status === 'FAIL') failCount += 1;
    else skipCount += 1;
    console.log(
      `[${r.status.padEnd(4)}] (${r.durationMs}ms) ${r.stage} :: ${r.name} -> ${r.detail}`,
    );
  }

  console.log(
    `\nSummary: ${passCount} PASS, ${failCount} FAIL, ${skipCount} SKIP (Total: ${results.length})\n`,
  );
  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(
    `[FAIL] Fatal itinerary E2E error: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
