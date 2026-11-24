import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import {
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  ServiceUnavailableException,
  BadGatewayException,
} from '@nestjs/common';
import { CoreApiClient } from './core-api.client';
import { AiApiClient } from './ai-api.client';

describe('ACL Security & Fault Tolerance Tests', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.INTERNAL_SERVICE_KEY = 'test-core-internal-key-32chars!!';
    process.env.INTERNAL_AI_KEY = 'test-ai-internal-key-32chars!!!';
    process.env.CORE_SERVICE_URL = 'http://127.0.0.1:3001';
    process.env.AI_SERVICE_URL = 'http://127.0.0.1:5000';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('CoreApiClient Security & Error Differentiation', () => {
    let client: CoreApiClient;
    let mockHttpService: any;

    beforeEach(async () => {
      mockHttpService = {
        get: jest.fn(),
        post: jest.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CoreApiClient,
          { provide: HttpService, useValue: mockHttpService },
        ],
      }).compile();

      client = module.get<CoreApiClient>(CoreApiClient);
    });

    it('should fail fast in constructor if INTERNAL_SERVICE_KEY is unset', () => {
      delete process.env.INTERNAL_SERVICE_KEY;
      expect(() => new CoreApiClient(mockHttpService)).toThrow(
        /INTERNAL_SERVICE_KEY must be set/,
      );
    });

    it('should pass X-Internal-Service-Key and correlation ID on requests', async () => {
      mockHttpService.get.mockReturnValue(
        of({ data: { candidates: [{ restaurant_id: 'r1' }], total: 1 } }),
      );

      const res = await client.getCandidates({ correlationId: 'cid-123' });
      expect(res).toHaveLength(1);
      expect(mockHttpService.get).toHaveBeenCalledWith(
        expect.stringContaining('/candidates'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Internal-Service-Key': 'test-core-internal-key-32chars!!',
            'X-Correlation-Id': 'cid-123',
          }),
        }),
      );
    });

    it('should throw UnauthorizedException when Core responds with 401 Unauthorized', async () => {
      const error: any = new Error('Unauthorized');
      error.response = { status: 401, data: { message: 'Invalid token/key' } };
      mockHttpService.get.mockReturnValue(throwError(() => error));

      await expect(client.getCandidates()).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw ServiceUnavailableException when Core request times out (ECONNABORTED)', async () => {
      const error: any = new Error('timeout of 4000ms exceeded');
      error.code = 'ECONNABORTED';
      mockHttpService.get.mockReturnValue(throwError(() => error));

      await expect(client.getCandidates()).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('should throw ServiceUnavailableException when Core connection is refused (ECONNREFUSED)', async () => {
      const error: any = new Error('connect ECONNREFUSED 127.0.0.1:3001');
      error.code = 'ECONNREFUSED';
      mockHttpService.get.mockReturnValue(throwError(() => error));

      await expect(client.getCandidates()).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('should throw BadGatewayException when Core returns 500 Internal Server Error', async () => {
      const error: any = new Error('Internal Server Error');
      error.response = { status: 500, data: { message: 'DB crash' } };
      mockHttpService.get.mockReturnValue(throwError(() => error));

      await expect(client.getCandidates()).rejects.toThrow(BadGatewayException);
    });

    it('should return empty candidate list on 404 (no candidate found)', async () => {
      const error: any = new Error('Not Found');
      error.response = { status: 404, data: {} };
      mockHttpService.get.mockReturnValue(throwError(() => error));

      const res = await client.getCandidates();
      expect(res).toEqual([]);
    });
  });

  describe('AiApiClient Security & Fallback Differentiation', () => {
    let client: AiApiClient;
    let mockHttpService: any;

    beforeEach(async () => {
      mockHttpService = {
        post: jest.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AiApiClient,
          { provide: HttpService, useValue: mockHttpService },
        ],
      }).compile();

      client = module.get<AiApiClient>(AiApiClient);
    });

    it('should fail fast in constructor if INTERNAL_AI_KEY is unset', () => {
      delete process.env.INTERNAL_AI_KEY;
      expect(() => new AiApiClient(mockHttpService)).toThrow(
        /INTERNAL_AI_KEY must be set/,
      );
    });

    it('should throw UnauthorizedException on 401 and NEVER fall back silently to heuristic', async () => {
      const error: any = new Error('Unauthorized');
      error.response = { status: 401, data: { detail: 'Invalid AI API Key' } };
      mockHttpService.post.mockReturnValue(throwError(() => error));

      await expect(
        client.optimizeRoute({
          restaurants: [
            {
              id: 'r1',
              lat: 10.7,
              lng: 106.6,
              open: '08:00',
              close: '22:00',
              duration_mins: 45,
            },
          ],
          start_lat: 10.7,
          start_lng: 106.6,
          start_time: '11:00',
          routing_mode: 'motorbike',
          budget_vnd: 200000,
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should trip circuit breaker and fall back to greedy heuristic on timeout (ECONNABORTED)', async () => {
      const error: any = new Error('timeout of 3500ms exceeded');
      error.code = 'ECONNABORTED';
      mockHttpService.post.mockReturnValue(throwError(() => error));

      const result = await client.optimizeRoute({
        restaurants: [
          {
            id: 'r1',
            lat: 10.7,
            lng: 106.6,
            open: '08:00',
            close: '22:00',
            duration_mins: 45,
          },
        ],
        start_lat: 10.7,
        start_lng: 106.6,
        start_time: '11:00',
        routing_mode: 'motorbike',
        budget_vnd: 200000,
      });

      expect(result).toBeDefined();
      expect(result.solver).toBe('Gastronomic Greedy Fallback');
      expect(result.stops).toHaveLength(1);
      expect(result.stops[0].restaurant_id).toBe('r1');
    });

    it('should map Planning request DTO into canonical AI schema and return mapped response', async () => {
      const mockAiResponse = {
        data: {
          stops: [
            {
              id: 'rest_123',
              name: 'Pho Pasteur',
              lat: 10.77,
              lon: 106.69,
              order_index: 1,
              meal_type: 'main',
              arrival_time: '11:15',
              departure_time: '12:00',
              dining_duration_mins: 45,
              transit_time_mins: 15,
              distance_to_next_km: 2.1,
              estimated_cost: 65000,
            },
          ],
          total_distance_km: 2.1,
          total_duration_mins: 60,
          algorithm_used: 'OR-Tools TSPTW',
          routing_mode: 'motorbike',
        },
      };

      mockHttpService.post.mockReturnValue(of(mockAiResponse));

      const result = await client.optimizeRoute({
        restaurants: [
          {
            id: 'rest_123',
            name: 'Pho Pasteur',
            lat: 10.77,
            lng: 106.69,
            open: '08:00',
            close: '22:00',
            duration_mins: 45,
            avg_price: 65000,
          },
        ],
        start_lat: 10.76,
        start_lng: 106.68,
        start_time: '11:00',
        routing_mode: 'motorbike',
        budget_vnd: 250000,
        desired_stops: 1,
      });

      // Verify outbound canonical payload mapping
      expect(mockHttpService.post).toHaveBeenCalledWith(
        'http://127.0.0.1:5000/routes/optimize',
        expect.objectContaining({
          start_location: [10.76, 106.68],
          start_time_mins: 660,
          budget: 250000,
          routing_mode: 'motorbike',
          desired_stops: 1,
          candidates: [
            expect.objectContaining({
              id: 'rest_123',
              name: 'Pho Pasteur',
              lat: 10.77,
              lon: 106.69,
              open_time: '08:00',
              close_time: '22:00',
            }),
          ],
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Internal-AI-Key': 'test-ai-internal-key-32chars!!!',
          }),
        }),
      );

      // Verify response mapping
      expect(result.solver).toBe('OR-Tools TSPTW');
      expect(result.stops).toHaveLength(1);
      expect(result.stops[0].restaurant_id).toBe('rest_123');
      expect(result.stops[0].order_index).toBe(1);
      expect(result.stops[0].arrival_time).toBe('11:15');
      expect(result.stops[0].departure_time).toBe('12:00');
      expect(result.stops[0].distance_km).toBe(2.1);
      expect(result.total_distance_km).toBe(2.1);
    });

    it('should throw ForbiddenException on 403 and NEVER fall back silently', async () => {
      const error: any = new Error('Forbidden');
      error.response = { status: 403, data: { detail: 'Forbidden: Invalid internal AI key' } };
      mockHttpService.post.mockReturnValue(throwError(() => error));

      await expect(
        client.optimizeRoute({
          restaurants: [
            {
              id: 'r1',
              lat: 10.7,
              lng: 106.6,
              open: '08:00',
              close: '22:00',
              duration_mins: 45,
            },
          ],
          start_lat: 10.7,
          start_lng: 106.6,
          start_time: '11:00',
          routing_mode: 'motorbike',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException on 400/422 and NEVER fall back silently', async () => {
      const error422: any = new Error('Unprocessable Entity');
      error422.response = {
        status: 422,
        data: { detail: [{ loc: ['body', 'candidates'], msg: 'field required' }] },
      };
      mockHttpService.post.mockReturnValue(throwError(() => error422));

      await expect(
        client.optimizeRoute({
          restaurants: [],
          start_lat: 10.7,
          start_lng: 106.6,
          start_time: '11:00',
          routing_mode: 'motorbike',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should trip circuit breaker and fall back to greedy heuristic on connection refused', async () => {
      const error: any = new Error('connect ECONNREFUSED 127.0.0.1:5000');
      error.code = 'ECONNREFUSED';
      mockHttpService.post.mockReturnValue(throwError(() => error));

      const result = await client.optimizeRoute({
        restaurants: [
          {
            id: 'r1',
            lat: 10.7,
            lng: 106.6,
            open: '08:00',
            close: '22:00',
            duration_mins: 45,
          },
        ],
        start_lat: 10.7,
        start_lng: 106.6,
        start_time: '11:00',
        routing_mode: 'motorbike',
        budget_vnd: 200000,
      });

      expect(result).toBeDefined();
      expect(result.solver).toBe('Gastronomic Greedy Fallback');
      expect(result.stops).toHaveLength(1);
    });
  });
});

