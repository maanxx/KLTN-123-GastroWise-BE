import { PartialType } from '@nestjs/mapped-types';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  ValidateIf,
} from 'class-validator';
import { CreateReviewDto } from './create-review.dto';

export class UpdateReviewDto extends PartialType(CreateReviewDto) {
  @IsOptional()
  @IsIn(['active', 'hidden', 'pending'])
  status?: 'active' | 'hidden' | 'pending';

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsDateString()
  pinnedAt?: Date | string | null;
}
