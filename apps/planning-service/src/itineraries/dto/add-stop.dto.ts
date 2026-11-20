import { IsNotEmpty, IsOptional, IsString, IsNumber } from 'class-validator';

export class AddStopDto {
  @IsNotEmpty()
  @IsString()
  restaurant_id: string;

  @IsOptional()
  @IsNumber()
  insert_after_order?: number;
}
