// src/interactions/dto/create-interaction.dto.ts
import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { InteractionEventType, TargetType } from '../schemas/interaction.schema';

export class CreateInteractionDto {
  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsNotEmpty()
  @IsEnum(InteractionEventType)
  eventType: string;

  @IsNotEmpty()
  @IsEnum(TargetType)
  targetType: string;

  @IsNotEmpty()
  @IsString()
  targetId: string;

  @IsOptional()
  @IsNumber()
  durationMs?: number;

  @IsOptional()
  metadata?: Record<string, any>;
}

