import { IsArray, IsNotEmpty, IsString } from 'class-validator';

export class ReorderStopsDto {
  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  stop_ids: string[];
}
