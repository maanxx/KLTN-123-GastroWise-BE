// src/taste-dna/dto/taste-quiz.dto.ts
import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class TasteQuizDto {
  @IsNotEmpty()
  @IsString()
  spicyLevel: string; // 'none' | 'mild' | 'medium' | 'hot' | 'extreme'

  @IsNotEmpty()
  @IsString()
  sweetTooth: string; // 'low' | 'moderate' | 'high'

  @IsNotEmpty()
  @IsString()
  savoryPreference: string; // 'light' | 'balanced' | 'rich_umami'

  @IsArray()
  @IsString({ each: true })
  cuisines: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dietary?: string[];

  @IsOptional()
  @IsString()
  budget?: string;
}

