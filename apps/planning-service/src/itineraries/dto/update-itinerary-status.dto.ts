import { IsIn, IsNotEmpty } from 'class-validator';

export class UpdateItineraryStatusDto {
  @IsNotEmpty()
  @IsIn(['generated', 'confirmed', 'completed', 'cancelled'])
  status: 'generated' | 'confirmed' | 'completed' | 'cancelled';
}
