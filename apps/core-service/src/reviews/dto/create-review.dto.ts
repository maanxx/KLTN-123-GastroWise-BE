import {
  IsNotEmpty,
  IsNumber,
  IsString,
  IsOptional,
  IsArray,
  Min,
  Max,
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
  @Max(10)
  diemReview: number;

  @IsNotEmpty()
  @IsString()
  noiDung: string;

  @IsNotEmpty()
  @IsString()
  restaurantId: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  userName?: string;

  @IsOptional()
  @IsArray()
  images?: string[];

  @IsOptional()
  @IsString()
  aiSentimentLabel?: string;

  @IsOptional()
  @IsNumber()
  aiSentimentScore?: number;
}
