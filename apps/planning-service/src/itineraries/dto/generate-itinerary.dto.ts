import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

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
  @Min(0)
  budget?: number;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  stop_count?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  desired_stops?: number;

  @IsOptional()
  @IsIn(['motorbike', 'car', 'walking'])
  routing_mode?: string;

  @IsOptional()
  @IsNumber()
  @Min(15)
  @Max(1440)
  duration_mins?: number;
}
