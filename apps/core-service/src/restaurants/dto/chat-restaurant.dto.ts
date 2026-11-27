import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ChatRestaurantDto {
  @IsNotEmpty()
  @IsString()
  message: string;

  @IsOptional()
  @IsString()
  userLat?: string;

  @IsOptional()
  @IsString()
  userLon?: string;
}
