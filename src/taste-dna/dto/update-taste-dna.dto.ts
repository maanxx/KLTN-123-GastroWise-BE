// src/taste-dna/dto/update-taste-dna.dto.ts
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class UpdateTasteDnaDto {
  @IsOptional()
  @IsNumber()
  @Min(0.0)
  @Max(1.0)
  spicy?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.0)
  @Max(1.0)
  sweet?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.0)
  @Max(1.0)
  sour?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.0)
  @Max(1.0)
  salty?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.0)
  @Max(1.0)
  umami?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.0)
  @Max(1.0)
  bitter?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  favoriteCuisines?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dietaryRestrictions?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dislikedIngredients?: string[];

  @IsOptional()
  @IsString()
  budgetPreference?: string;
}
