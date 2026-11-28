import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SUPPORTED_INGESTION_SOURCES } from '@shared/ingestion';

export class ValidateRestaurantDataQualityDto {
  @IsOptional()
  @IsString()
  @MaxLength(2 * 1024 * 1024)
  rawContent?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  records?: Array<Record<string, unknown>>;

  @IsOptional()
  @IsIn(['json', 'jsonl', 'auto'])
  format?: 'json' | 'jsonl' | 'auto';

  @IsOptional()
  @IsString()
  @IsIn(SUPPORTED_INGESTION_SOURCES)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  batchId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  maxRejectedSample?: number;
}
