import { IsOptional, IsNumber, IsString } from 'class-validator';

export class RecalculateItineraryDto {
  @IsOptional()
  @IsNumber()
  budget?: number;

  @IsOptional()
  @IsString()
  start_time?: string;

  @IsOptional()
  @IsString()
  routing_mode?: string;

  @IsOptional()
  @IsNumber()
  lat?: number;

  @IsOptional()
  @IsNumber()
  lng?: number;
}

