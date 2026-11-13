import { IsNotEmpty, IsString, IsNumber, IsOptional } from 'class-validator';

export class GenerateItineraryDto {
  @IsNotEmpty()
  @IsString()
  prompt: string;

  @IsNotEmpty()
  @IsString()
  start_time: string;

  @IsNotEmpty()
  @IsString()
  end_time: string;

  @IsOptional()
  @IsNumber()
  budget?: number;

  @IsOptional()
  @IsNumber()
  lat?: number;

  @IsOptional()
  @IsNumber()
  lng?: number;

  @IsOptional()
  @IsNumber()
  stop_count?: number;

  @IsOptional()
  @IsString()
  routing_mode?: string;

  @IsOptional()
  @IsNumber()
  duration_mins?: number;
}

