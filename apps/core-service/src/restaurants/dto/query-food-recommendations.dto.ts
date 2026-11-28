import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const MAX_RECOMMENDATION_BUDGET_VND = 50_000_000;

export class QueryFoodRecommendationsDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  keyword?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(100)
  radiusKm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(MAX_RECOMMENDATION_BUDGET_VND)
  minBudget?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(MAX_RECOMMENDATION_BUDGET_VND)
  maxBudget?: number;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  cuisines?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  categories?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  isVegetarian?: 'true' | 'false';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
