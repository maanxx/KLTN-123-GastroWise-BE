// back-end/src/users/dto/update-user.dto.ts
import {
  IsOptional,
  IsString,
  MaxLength,
  IsArray,
  IsIn,
} from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsString()
  designation?: string;

  @IsOptional()
  @IsString()
  picture?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  bio?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  preferences?: string[];

  @IsOptional()
  @IsIn(['user', 'admin', 'owner'])
  role?: 'user' | 'admin' | 'owner';

  @IsOptional()
  @IsIn(['active', 'banned'])
  status?: 'active' | 'banned';
}
