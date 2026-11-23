import {
  Injectable,
  Logger,
  UnauthorizedException,
  ServiceUnavailableException,
  BadGatewayException,
  NotFoundException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { randomUUID } from 'crypto';
import {
  RestaurantCandidateDto,
  TasteDnaProfileDto,
  TasteDnaFeedbackDto,
  RecordInteractionEventDto,
} from '@shared/contracts/core.contracts';

@Injectable()
export class CoreApiClient {
  private readonly logger = new Logger(CoreApiClient.name);
  private readonly baseUrl: string;
  private readonly internalKey: string;

  constructor(private readonly httpService: HttpService) {
    this.baseUrl = process.env.CORE_SERVICE_URL || 'http://127.0.0.1:3001';
    const key = process.env.INTERNAL_SERVICE_KEY;
    if (!key) {
      throw new Error(
        'Missing mandatory security configuration: INTERNAL_SERVICE_KEY must be set in environment variables',
      );
    }
    this.internalKey = key;
  }

  private getHeaders(correlationId?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'X-Internal-Service-Key': this.internalKey,
      'X-Correlation-Id': correlationId || randomUUID(),
    };
    return headers;
  }

  private handleError(
    method: string,
    url: string,
    err: any,
    startTime: number,
    correlationId?: string,
  ): never {
    const durationMs = Date.now() - startTime;
    const cid = correlationId || 'unknown';
    const timestamp = new Date().toISOString();

    if (err.response) {
      const status = err.response.status;
      const data = err.response.data;

      this.logger.error(
        JSON.stringify({
          timestamp,
          level: 'ERROR',
          context: 'CoreApiClient',
          method,
          url,
          status,
          durationMs,
          correlationId: cid,
          message: data?.message || err.message,
        }),
      );

      if (status === 401 || status === 403) {
        throw new UnauthorizedException(
          `Core Service authentication failed (HTTP ${status}) [cid: ${cid}]: ${data?.message || err.message}`,
        );
      }
      if (status === 404) {
        throw new NotFoundException(
          `Core Service resource not found [cid: ${cid}]: ${data?.message || err.message}`,
        );
      }
      if (status >= 500) {
        throw new BadGatewayException(
          `Core Service returned server error (HTTP ${status}) [cid: ${cid}]: ${data?.message || err.message}`,
        );
      }
      throw new BadGatewayException(
        `Core Service communication error (HTTP ${status}) [cid: ${cid}]: ${data?.message || err.message}`,
      );
    }

    const isTimeout =
      err.code === 'ECONNABORTED' ||
      err.code === 'ETIMEDOUT' ||
      err.message?.includes('timeout');
    const isRefused = err.code === 'ECONNREFUSED';

    this.logger.error(
      JSON.stringify({
        timestamp,
        level: 'ERROR',
        context: 'CoreApiClient',
        method,
        url,
        code: err.code || 'UNKNOWN',
        durationMs,
        correlationId: cid,
        message: err.message,
      }),
    );

    if (isTimeout) {
      throw new ServiceUnavailableException(
        `Core Service request timed out after ${durationMs}ms [cid: ${cid}]`,
      );
    }

    if (isRefused) {
      throw new ServiceUnavailableException(
        `Core Service connection refused at ${this.baseUrl} [cid: ${cid}]`,
      );
    }

    throw new BadGatewayException(
      `Core Service communication failed [cid: ${cid}]: ${err.message}`,
    );
  }

  async getCandidates(params?: {
    tags?: string | string[];
    lat?: number;
    lng?: number;
    radius_km?: number;
    limit?: number;
    correlationId?: string;
  }): Promise<RestaurantCandidateDto[]> {
    const startTime = Date.now();
    const cid = params?.correlationId || randomUUID();
    const url = `${this.baseUrl}/api/v1/internal/restaurants/candidates`;

    try {
      const response = await firstValueFrom(
        this.httpService.get<{
          candidates: RestaurantCandidateDto[];
          total: number;
        }>(url, {
          headers: this.getHeaders(cid),
          params: {
            tags: params?.tags,
            lat: params?.lat,
            lng: params?.lng,
            radius_km: params?.radius_km || 10,
            limit: params?.limit || 50,
          },
          timeout: 4000,
        }),
      );
      return response.data?.candidates || [];
    } catch (err: any) {
      if (err.response?.status === 404) {
        return [];
      }
      this.handleError('GET', url, err, startTime, cid);
    }
  }

  async getRestaurantById(
    id: string,
    correlationId?: string,
  ): Promise<RestaurantCandidateDto | null> {
    const startTime = Date.now();
    const cid = correlationId || randomUUID();
    const url = `${this.baseUrl}/api/v1/internal/restaurants/${id}`;

    try {
      const response = await firstValueFrom(
        this.httpService.get<RestaurantCandidateDto>(url, {
          headers: this.getHeaders(cid),
          timeout: 3000,
        }),
      );
      return response.data || null;
    } catch (err: any) {
      if (err.response?.status === 404) {
        return null;
      }
      this.handleError('GET', url, err, startTime, cid);
    }
  }

  async getTasteDna(
    userId: string,
    correlationId?: string,
  ): Promise<TasteDnaProfileDto | null> {
    const startTime = Date.now();
    const cid = correlationId || randomUUID();
    const url = `${this.baseUrl}/api/v1/internal/taste-dna/${userId}`;

    try {
      const response = await firstValueFrom(
        this.httpService.get<TasteDnaProfileDto>(url, {
          headers: this.getHeaders(cid),
          timeout: 3000,
        }),
      );
      return response.data || null;
    } catch (err: any) {
      if (err.response?.status === 404) {
        return null;
      }
      this.handleError('GET', url, err, startTime, cid);
    }
  }

  async applyFeedback(
    userId: string,
    dto: TasteDnaFeedbackDto,
    correlationId?: string,
  ): Promise<boolean> {
    const startTime = Date.now();
    const cid = correlationId || randomUUID();
    const url = `${this.baseUrl}/api/v1/internal/taste-dna/${userId}/feedback`;

    try {
      await firstValueFrom(
        this.httpService.post(url, dto, {
          headers: this.getHeaders(cid),
          timeout: 3000,
        }),
      );
      return true;
    } catch (err: any) {
      this.handleError('POST', url, err, startTime, cid);
    }
  }

  async recordInteraction(
    dto: RecordInteractionEventDto,
    correlationId?: string,
  ): Promise<boolean> {
    const startTime = Date.now();
    const cid = correlationId || randomUUID();
    const url = `${this.baseUrl}/api/v1/internal/interactions/event`;

    try {
      await firstValueFrom(
        this.httpService.post(url, dto, {
          headers: this.getHeaders(cid),
          timeout: 2000,
        }),
      );
      return true;
    } catch (err: any) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        this.handleError('POST', url, err, startTime, cid);
      }
      this.logger.warn(
        `CoreApiClient: recordInteraction failed non-critically (${err.message}) [cid: ${cid}]`,
      );
      return false;
    }
  }
}
