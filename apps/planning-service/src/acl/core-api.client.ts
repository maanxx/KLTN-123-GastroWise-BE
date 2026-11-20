import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
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
    this.internalKey =
      process.env.INTERNAL_SERVICE_KEY || 'default-secret-change-in-production';
  }

  private getHeaders(correlationId?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'X-Internal-Service-Key': this.internalKey,
    };
    if (correlationId) {
      headers['X-Correlation-Id'] = correlationId;
    }
    return headers;
  }

  async getCandidates(params?: {
    tags?: string | string[];
    lat?: number;
    lng?: number;
    radius_km?: number;
    limit?: number;
    correlationId?: string;
  }): Promise<RestaurantCandidateDto[]> {
    try {
      const url = `${this.baseUrl}/api/v1/internal/restaurants/candidates`;
      const response = await firstValueFrom(
        this.httpService.get<{
          candidates: RestaurantCandidateDto[];
          total: number;
        }>(url, {
          headers: this.getHeaders(params?.correlationId),
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
      this.logger.error(`CoreApiClient: getCandidates failed: ${err.message}`);
      return [];
    }
  }

  async getRestaurantById(
    id: string,
    correlationId?: string,
  ): Promise<RestaurantCandidateDto | null> {
    try {
      const url = `${this.baseUrl}/api/v1/internal/restaurants/${id}`;
      const response = await firstValueFrom(
        this.httpService.get<RestaurantCandidateDto>(url, {
          headers: this.getHeaders(correlationId),
          timeout: 3000,
        }),
      );
      return response.data || null;
    } catch (err: any) {
      this.logger.warn(
        `CoreApiClient: getRestaurantById(${id}) failed: ${err.message}`,
      );
      return null;
    }
  }

  async getTasteDna(
    userId: string,
    correlationId?: string,
  ): Promise<TasteDnaProfileDto | null> {
    try {
      const url = `${this.baseUrl}/api/v1/internal/taste-dna/${userId}`;
      const response = await firstValueFrom(
        this.httpService.get<TasteDnaProfileDto>(url, {
          headers: this.getHeaders(correlationId),
          timeout: 3000,
        }),
      );
      return response.data || null;
    } catch (err: any) {
      this.logger.warn(
        `CoreApiClient: getTasteDna(${userId}) failed: ${err.message}`,
      );
      return null;
    }
  }

  async applyFeedback(
    userId: string,
    dto: TasteDnaFeedbackDto,
    correlationId?: string,
  ): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/api/v1/internal/taste-dna/${userId}/feedback`;
      await firstValueFrom(
        this.httpService.post(url, dto, {
          headers: this.getHeaders(correlationId),
          timeout: 3000,
        }),
      );
      return true;
    } catch (err: any) {
      this.logger.warn(`CoreApiClient: applyFeedback failed: ${err.message}`);
      return false;
    }
  }

  async recordInteraction(
    dto: RecordInteractionEventDto,
    correlationId?: string,
  ): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/api/v1/internal/interactions/event`;
      await firstValueFrom(
        this.httpService.post(url, dto, {
          headers: this.getHeaders(correlationId),
          timeout: 2000,
        }),
      );
      return true;
    } catch (err: any) {
      this.logger.warn(
        `CoreApiClient: recordInteraction failed: ${err.message}`,
      );
      return false;
    }
  }
}
