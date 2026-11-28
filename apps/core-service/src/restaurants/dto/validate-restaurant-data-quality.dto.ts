import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';

export class ValidateRestaurantDataQualityDto {
  @IsOptional()
  @IsString()
  rawContent?: string;

  @IsOptional()
  @IsArray()
  records?: Array<Record<string, unknown>>;

  @IsOptional()
  @IsIn(['json', 'jsonl', 'auto'])
  format?: 'json' | 'jsonl' | 'auto';

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  batchId?: string;
}
