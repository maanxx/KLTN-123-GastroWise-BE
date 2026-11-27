import {
  IsNotEmpty,
  IsNumber,
  IsString,
  IsOptional,
  IsArray,
  IsMongoId,
  Min,
  Max,
  MinLength,
  MaxLength,
} from 'class-validator';

export class CreateReviewDto {
  @IsOptional()
  @IsString()
  tenQuan?: string;

  @IsOptional()
  @IsString()
  urlGoc?: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  @Max(5)
  diemReview: number;

  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  noiDung: string;

  @IsNotEmpty()
  @IsString()
  restaurantId: string;

  @IsOptional()
  @IsMongoId()
  userId?: string;

  @IsOptional()
  @IsString()
  userName?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @IsOptional()
  @IsString()
  aiSentimentLabel?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  aiSentimentScore?: number;
}
