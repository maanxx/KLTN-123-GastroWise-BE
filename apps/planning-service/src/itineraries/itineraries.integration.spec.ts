import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { getModelToken } from '@nestjs/mongoose';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { Types } from 'mongoose';
import { ItinerariesController } from './itineraries.controller';
import { ItinerariesService } from './itineraries.service';
import { Itinerary } from './schemas/itinerary.schema';
import { CoreApiClient } from '../acl/core-api.client';
import { AiApiClient } from '../acl/ai-api.client';
import { JwtStrategy } from '../auth/jwt.strategy';
import { RolesGuard } from '../auth/roles.guard';

const TEST_JWT_SECRET = 'm10-12-test-only-jwt-secret-32chars!!';
const TEST_INTERNAL_SERVICE_KEY = 'm10-12-test-only-core-key-32chars!!';
const TEST_INTERNAL_AI_KEY = 'm10-12-test-only-ai-key-32chars!!!!';

const USER_A_ID = '6740000000000000000000a1';
const USER_B_ID = '6740000000000000000000b2';
const ADMIN_ID = '6740000000000000000000ff';

const DETERMINISTIC_CANDIDATES = [
  {
    restaurant_id: '6b0a8f389e583fdd0ef73e27',
    name: 'Phở Hòa Pasteur',
    address: '260C Pasteur, Phường Võ Thị Sáu, Quận 3, TP. HCM',
    lat: 10.7852,
    lng: 106.6879,
    rating: 4.5,
    average_cost: 75000,
    tags: ['Phở', 'Bò', 'Món Việt'],
    open_time: '06:00 - 22:00',
    featured_image: 'https://cdn.local.test/pho-hoa.jpg',
  },
  {
    restaurant_id: '6b0a8f389e583fdd0ef73e28',
    name: 'Bánh Mì Huynh Hoa',
    address: '26 Lê Thị Riêng, Quận 1, TP. HCM',
    lat: 10.7722,
    lng: 106.6921,
    rating: 4.7,
    average_cost: 65000,
    tags: ['Bánh mì', 'Ăn vặt'],
    open_time: '08:00 - 22:00',
    featured_image: 'https://cdn.local.test/huynh-hoa.jpg',
  },
  {
    restaurant_id: '6b0a8f389e583fdd0ef73e29',
    name: 'Cơm Tấm Ba Ghiền',
    address: '84 Đặng Văn Ngữ, Phú Nhuận, TP. HCM',
    lat: 10.7931,
    lng: 106.6712,
    rating: 4.6,
    average_cost: 80000,
    tags: ['Cơm tấm', 'Nướng'],
    open_time: '07:30 - 21:30',
    featured_image: 'https://cdn.local.test/ba-ghien.jpg',
  },
];

/**
 * Dispatches a full HTTP request directly through the NestJS Express pipeline
 * (ValidationPipe, Passport JwtAuthGuard, RolesGuard, Controller, Exception Filters)
 * in-process without binding a TCP socket, so tests run deterministically in any
 * sandboxed or CI environment.
 */
async function dispatchHttp(
  expressApp: any,
  method: string,
  url: string,
  options: { token?: string; body?: unknown } = {},
): Promise<{ status: number; body: any; text: string }> {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.method = method.toUpperCase();
  req.url = url;
  req.headers = { host: '127.0.0.1' };

  if (options.token) {
    req.headers.authorization = `Bearer ${options.token}`;
  }

  let payloadBuf: Buffer | null = null;
  if (options.body !== undefined) {
    payloadBuf = Buffer.from(JSON.stringify(options.body), 'utf8');
    req.headers['content-type'] = 'application/json';
    req.headers['content-length'] = String(payloadBuf.length);
  }

  const res = new ServerResponse(req);
  const chunks: Buffer[] = [];
  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);

  return new Promise((resolve, reject) => {
    res.write = ((chunk: any, ...rest: any[]) => {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      return origWrite(chunk, ...rest);
    }) as any;

    res.end = ((chunk?: any, ...rest: any[]) => {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      const out = origEnd(chunk, ...rest);
      const raw = Buffer.concat(chunks).toString('utf8');
      // Strip raw HTTP header block if ServerResponse wrote directly to unattached buffer
      const sepIdx = raw.indexOf('\r\n\r\n');
      const text = sepIdx >= 0 && raw.startsWith('HTTP/') ? raw.slice(sepIdx + 4) : raw;
      let parsed: any = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text;
      }
      socket.destroy();
      resolve({ status: res.statusCode, body: parsed, text });
      return out;
    }) as any;

    res.on('error', reject);
    expressApp(req, res);

    if (payloadBuf) {
      req.push(payloadBuf);
    }
    req.push(null);
  });
}

function createInMemoryItineraryModel() {
  const store = new Map<string, any>();

  const attachSave = (record: any) => {
    const doc = {
      ...record,
      save: jest.fn().mockImplementation(async function saveDoc(this: any) {
        const plain = { ...this };
        delete plain.save;
        store.set(String(plain._id), JSON.parse(JSON.stringify(plain)));
        return attachSave(store.get(String(plain._id)));
      }),
    };
    return doc;
  };

  const ModelCtor: any = jest.fn().mockImplementation((initial: any) => {
    const _id = new Types.ObjectId().toString();
    return attachSave({ _id, ...initial });
  });

  ModelCtor._store = store;

  ModelCtor.find = jest.fn().mockImplementation((filter: any = {}) => ({
    sort: jest.fn().mockReturnValue({
      exec: jest.fn().mockImplementation(async () => {
        const all = Array.from(store.values()).map((r) =>
          JSON.parse(JSON.stringify(r)),
        );
        if (filter.user_id) {
          return all.filter((r) => r.user_id === filter.user_id);
        }
        return all;
      }),
    }),
  }));

  ModelCtor.findById = jest.fn().mockImplementation((id: string) => ({
    exec: jest.fn().mockImplementation(async () => {
      const found = store.get(String(id));
      return found ? attachSave(JSON.parse(JSON.stringify(found))) : null;
    }),
  }));

  ModelCtor.findByIdAndUpdate = jest
    .fn()
    .mockImplementation((id: string, update: any) => ({
      exec: jest.fn().mockImplementation(async () => {
        const existing = store.get(String(id));
        if (!existing) return null;
        const merged = { ...existing, ...(update?.$set || update) };
        store.set(String(id), JSON.parse(JSON.stringify(merged)));
        return JSON.parse(JSON.stringify(merged));
      }),
    }));

  ModelCtor.findByIdAndDelete = jest.fn().mockImplementation((id: string) => ({
    exec: jest.fn().mockImplementation(async () => {
      const existing = store.get(String(id));
      if (!existing) return null;
      store.delete(String(id));
      return existing;
    }),
  }));

  return ModelCtor;
}

describe('Planning Service Authenticated Itinerary Integration (M10.12)', () => {
  let app: INestApplication;
  let expressApp: any;
  let jwtService: JwtService;
  let mockHttpService: { get: jest.Mock; post: jest.Mock };
  let itineraryModel: any;
  let userAToken: string;
  let userBToken: string;
  let adminToken: string;
  let invalidSecretToken: string;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    process.env.INTERNAL_SERVICE_KEY = TEST_INTERNAL_SERVICE_KEY;
    process.env.INTERNAL_AI_KEY = TEST_INTERNAL_AI_KEY;
    process.env.CORE_SERVICE_URL = 'http://core-service.local:3001';
    process.env.AI_SERVICE_URL = 'http://ai-service.local:5000';

    itineraryModel = createInMemoryItineraryModel();
    mockHttpService = {
      get: jest.fn(),
      post: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({
          secret: TEST_JWT_SECRET,
          signOptions: {
            expiresIn: '1h',
            issuer: 'gastrowise-auth',
            audience: 'gastrowise-api',
          },
        }),
      ],
      controllers: [ItinerariesController],
      providers: [
        ItinerariesService,
        CoreApiClient,
        AiApiClient,
        JwtStrategy,
        RolesGuard,
        { provide: getModelToken(Itinerary.name), useValue: itineraryModel },
        { provide: HttpService, useValue: mockHttpService },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();
    expressApp = app.getHttpAdapter().getInstance();

    jwtService = moduleFixture.get(JwtService);
    userAToken = await jwtService.signAsync({
      sub: USER_A_ID,
      email: 'user-a@local.gastrowise.test',
      role: 'user',
    });
    userBToken = await jwtService.signAsync({
      sub: USER_B_ID,
      email: 'user-b@local.gastrowise.test',
      role: 'user',
    });
    adminToken = await jwtService.signAsync({
      sub: ADMIN_ID,
      email: 'admin@local.gastrowise.test',
      role: 'admin',
    });
    invalidSecretToken = await jwtService.signAsync(
      { sub: USER_A_ID, email: 'forged@local.gastrowise.test', role: 'user' },
      { secret: 'wrong-secret-must-be-rejected-by-planning' },
    );
  });

  beforeEach(() => {
    itineraryModel._store.clear();
    mockHttpService.get.mockReset();
    mockHttpService.post.mockReset();

    mockHttpService.get.mockImplementation((url: string) => {
      if (url.includes('/api/v1/internal/restaurants/candidates')) {
        return of({
          data: {
            candidates: DETERMINISTIC_CANDIDATES,
            total: DETERMINISTIC_CANDIDATES.length,
          },
        });
      }
      if (url.includes('/api/v1/internal/restaurants/')) {
        const id = url.split('/').pop();
        const found = DETERMINISTIC_CANDIDATES.find((c) => c.restaurant_id === id);
        if (found) {
          return of({ data: found });
        }
        const err: any = new Error('Not Found');
        err.response = { status: 404, data: { message: 'Not Found' } };
        return throwError(() => err);
      }
      if (url.includes('/api/v1/internal/taste-dna/')) {
        return of({
          data: {
            userId: USER_A_ID,
            flavorProfile: {
              spicy: 0.6,
              sweet: 0.5,
              sour: 0.5,
              salty: 0.5,
              bitter: 0.2,
              umami: 0.9,
            },
            preferredCuisines: ['Phở', 'Bánh mì'],
            dietaryRestrictions: [],
          },
        });
      }
      return of({ data: {} });
    });

    mockHttpService.post.mockImplementation((url: string) => {
      if (url.includes('/routes/optimize')) {
        return of({
          data: {
            stops: [
              {
                id: DETERMINISTIC_CANDIDATES[1].restaurant_id,
                order_index: 1,
                meal_type: 'starter',
                arrival_time: '11:08',
                departure_time: '11:53',
                transit_time_mins: 8,
                distance_to_next_km: 1.4,
                estimated_cost: 65000,
              },
              {
                id: DETERMINISTIC_CANDIDATES[0].restaurant_id,
                order_index: 2,
                meal_type: 'main',
                arrival_time: '12:03',
                departure_time: '12:48',
                transit_time_mins: 10,
                distance_to_next_km: 0,
                estimated_cost: 75000,
              },
            ],
            total_distance_km: 2.9,
            total_duration_mins: 108,
            algorithm_used: 'OR-Tools TSPTW',
          },
        });
      }
      return of({ data: { ok: true } });
    });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    process.env = { ...originalEnv };
  });

  it('rejects unauthenticated and invalid-JWT requests with HTTP 401', async () => {
    const noAuth = await dispatchHttp(expressApp, 'GET', '/api/v1/itineraries');
    expect(noAuth.status).toBe(401);

    const badJwt = await dispatchHttp(expressApp, 'GET', '/api/v1/itineraries', {
      token: invalidSecretToken,
    });
    expect(badJwt.status).toBe(401);
  });

  it('rejects missing required fields and [0,0] coordinates with HTTP 400 and persists nothing', async () => {
    const emptyRes = await dispatchHttp(
      expressApp,
      'POST',
      '/api/v1/itineraries/generate',
      { token: userAToken, body: {} },
    );
    expect(emptyRes.status).toBe(400);

    const zeroCoordRes = await dispatchHttp(
      expressApp,
      'POST',
      '/api/v1/itineraries/generate',
      {
        token: userAToken,
        body: {
          prompt: 'Phở ngon',
          start_time: '11:00',
          end_time: '14:00',
          lat: 0,
          lng: 0,
        },
      },
    );
    expect(zeroCoordRes.status).toBe(400);
    expect(itineraryModel._store.size).toBe(0);
  });

  it('executes full authenticated lifecycle: generate -> Core/AI headers -> snapshots -> mutate -> cross-user 403 -> delete -> 404', async () => {
    // 1. Generate itinerary as User A
    const genRes = await dispatchHttp(
      expressApp,
      'POST',
      '/api/v1/itineraries/generate',
      {
        token: userAToken,
        body: {
          prompt: 'Food tour phở và bánh mì',
          start_time: '11:00',
          end_time: '14:30',
          lat: 10.7769,
          lng: 106.7009,
          budget: 300000,
          desired_stops: 2,
          routing_mode: 'motorbike',
        },
      },
    );
    expect(genRes.status).toBe(201);

    const itineraryId = genRes.body._id;
    expect(itineraryId).toBeDefined();
    expect(genRes.body.user_id).toBe(USER_A_ID);
    expect(genRes.body.optimizedBy).toBe('OR-Tools TSPTW');
    expect(genRes.body.stops).toHaveLength(2);
    expect(genRes.body.stops.map((s: any) => s.order_index)).toEqual([1, 2]);

    // Verify independent snapshot fields persisted without Core DB coupling
    expect(genRes.body.stops[0]).toMatchObject({
      restaurant_id: DETERMINISTIC_CANDIDATES[1].restaurant_id,
      restaurant_name: 'Bánh Mì Huynh Hoa',
      restaurant_address: '26 Lê Thị Riêng, Quận 1, TP. HCM',
      restaurant_rating: 4.7,
      restaurant_image: 'https://cdn.local.test/huynh-hoa.jpg',
    });

    // Verify CoreApiClient sent X-Internal-Service-Key & AiApiClient sent X-Internal-AI-Key
    expect(mockHttpService.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/internal/restaurants/candidates'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Internal-Service-Key': TEST_INTERNAL_SERVICE_KEY,
        }),
      }),
    );
    expect(mockHttpService.post).toHaveBeenCalledWith(
      'http://ai-service.local:5000/routes/optimize',
      expect.objectContaining({
        start_location: [10.7769, 106.7009],
        desired_stops: 2,
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Internal-AI-Key': TEST_INTERNAL_AI_KEY,
        }),
      }),
    );

    // 2. Owner can list & read by ID
    const listRes = await dispatchHttp(expressApp, 'GET', '/api/v1/itineraries', {
      token: userAToken,
    });
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);

    const getRes = await dispatchHttp(
      expressApp,
      'GET',
      `/api/v1/itineraries/${itineraryId}`,
      { token: userAToken },
    );
    expect(getRes.status).toBe(200);
    expect(getRes.body._id).toBe(itineraryId);

    // 3. Cross-user access denial (User B cannot list, read, mutate, or delete User A's itinerary)
    const userBList = await dispatchHttp(expressApp, 'GET', '/api/v1/itineraries', {
      token: userBToken,
    });
    expect(userBList.status).toBe(200);
    expect(userBList.body).toEqual([]);

    const firstStopId = genRes.body.stops[0].stop_id;
    expect(
      (await dispatchHttp(expressApp, 'GET', `/api/v1/itineraries/${itineraryId}`, { token: userBToken })).status,
    ).toBe(403);
    expect(
      (await dispatchHttp(expressApp, 'PATCH', `/api/v1/itineraries/${itineraryId}`, { token: userBToken, body: { status: 'cancelled' } })).status,
    ).toBe(403);
    expect(
      (await dispatchHttp(expressApp, 'PATCH', `/api/v1/itineraries/${itineraryId}/reorder`, { token: userBToken, body: { stop_ids: [firstStopId] } })).status,
    ).toBe(403);
    expect(
      (await dispatchHttp(expressApp, 'POST', `/api/v1/itineraries/${itineraryId}/recalculate`, { token: userBToken, body: { budget: 150000 } })).status,
    ).toBe(403);
    expect(
      (await dispatchHttp(expressApp, 'POST', `/api/v1/itineraries/${itineraryId}/stops`, { token: userBToken, body: { restaurant_id: DETERMINISTIC_CANDIDATES[2].restaurant_id } })).status,
    ).toBe(403);
    expect(
      (await dispatchHttp(expressApp, 'DELETE', `/api/v1/itineraries/${itineraryId}/stops/${firstStopId}`, { token: userBToken })).status,
    ).toBe(403);
    expect(
      (await dispatchHttp(expressApp, 'DELETE', `/api/v1/itineraries/${itineraryId}`, { token: userBToken })).status,
    ).toBe(403);

    // Non-admin denied /all; admin allowed /all and :id
    expect(
      (await dispatchHttp(expressApp, 'GET', '/api/v1/itineraries/all', { token: userAToken })).status,
    ).toBe(403);
    expect(
      (await dispatchHttp(expressApp, 'GET', '/api/v1/itineraries/all', { token: adminToken })).status,
    ).toBe(200);
    expect(
      (await dispatchHttp(expressApp, 'GET', `/api/v1/itineraries/${itineraryId}`, { token: adminToken })).status,
    ).toBe(200);

    // 4. Owner mutations preserve snapshot fields
    const addRes = await dispatchHttp(
      expressApp,
      'POST',
      `/api/v1/itineraries/${itineraryId}/stops`,
      {
        token: userAToken,
        body: { restaurant_id: DETERMINISTIC_CANDIDATES[2].restaurant_id },
      },
    );
    expect(addRes.status).toBe(201);
    expect(addRes.body.stops).toHaveLength(3);
    expect(addRes.body.stops[2].restaurant_address).toBe(
      '84 Đặng Văn Ngữ, Phú Nhuận, TP. HCM',
    );

    const statusRes = await dispatchHttp(
      expressApp,
      'PATCH',
      `/api/v1/itineraries/${itineraryId}`,
      { token: userAToken, body: { status: 'confirmed' } },
    );
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.status).toBe('confirmed');
    expect(statusRes.body.confirmedBy).toBe(USER_A_ID);

    // 5. Missing ID returns 404
    expect(
      (await dispatchHttp(expressApp, 'GET', '/api/v1/itineraries/674000000000000000000099', { token: userAToken })).status,
    ).toBe(404);

    // 6. Owner delete removes itinerary cleanly and subsequent GET returns 404
    expect(
      (await dispatchHttp(expressApp, 'DELETE', `/api/v1/itineraries/${itineraryId}`, { token: userAToken })).status,
    ).toBe(200);
    expect(
      (await dispatchHttp(expressApp, 'GET', `/api/v1/itineraries/${itineraryId}`, { token: userAToken })).status,
    ).toBe(404);
    expect(itineraryModel._store.size).toBe(0);
  });

  it('applies deterministic greedy fallback when AI service times out and still persists valid snapshots', async () => {
    mockHttpService.post.mockImplementation((url: string) => {
      if (url.includes('/routes/optimize')) {
        const timeoutErr: any = new Error('timeout of 3500ms exceeded');
        timeoutErr.code = 'ECONNABORTED';
        return throwError(() => timeoutErr);
      }
      return of({ data: { ok: true } });
    });

    const res = await dispatchHttp(
      expressApp,
      'POST',
      '/api/v1/itineraries/generate',
      {
        token: userAToken,
        body: {
          prompt: 'Food tour fallback test',
          start_time: '11:00',
          end_time: '14:30',
          lat: 10.7769,
          lng: 106.7009,
          budget: 250000,
          desired_stops: 2,
        },
      },
    );
    expect(res.status).toBe(201);
    expect(res.body.optimizedBy).toBe('Gastronomic Greedy Fallback');
    expect(res.body.stops.length).toBeGreaterThanOrEqual(2);
    expect(res.body.stops[0].restaurant_address).toBeTruthy();
    expect(res.body.stops[0].restaurant_rating).toBeGreaterThan(0);
  });

  it('aborts generation without persisting partial records when AI rejects internal auth (403) or contract validation (422)', async () => {
    mockHttpService.post.mockImplementationOnce(() => {
      const forbiddenErr: any = new Error('Forbidden');
      forbiddenErr.response = {
        status: 403,
        data: { detail: 'Invalid internal AI service key' },
      };
      return throwError(() => forbiddenErr);
    });

    const forbiddenRes = await dispatchHttp(
      expressApp,
      'POST',
      '/api/v1/itineraries/generate',
      {
        token: userAToken,
        body: {
          prompt: 'Auth failure must not persist',
          start_time: '11:00',
          end_time: '14:30',
          lat: 10.7769,
          lng: 106.7009,
          budget: 250000,
        },
      },
    );
    expect(forbiddenRes.status).toBe(403);
    expect(itineraryModel._store.size).toBe(0);

    mockHttpService.post.mockImplementationOnce(() => {
      const validationErr: any = new Error('Unprocessable Entity');
      validationErr.response = {
        status: 422,
        data: { detail: 'Invalid candidate payload' },
      };
      return throwError(() => validationErr);
    });

    const badContractRes = await dispatchHttp(
      expressApp,
      'POST',
      '/api/v1/itineraries/generate',
      {
        token: userAToken,
        body: {
          prompt: 'Contract failure must not persist',
          start_time: '11:00',
          end_time: '14:30',
          lat: 10.7769,
          lng: 106.7009,
          budget: 250000,
        },
      },
    );
    expect(badContractRes.status).toBe(400);
    expect(itineraryModel._store.size).toBe(0);
  });
});
