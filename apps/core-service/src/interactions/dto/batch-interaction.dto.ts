// src/interactions/dto/batch-interaction.dto.ts
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { CreateInteractionDto } from './create-interaction.dto';

export class BatchInteractionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateInteractionDto)
  events: CreateInteractionDto[];
}
