import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateRestaurantDto {
  @IsNotEmpty()
  @IsString()
  tenQuan: string;

  @IsOptional()
  @IsString()
  cityId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  diemTrungBinh?: number;

  @IsOptional()
  @IsString()
  diaChi?: string;

  @IsOptional()
  @IsString()
  gioMoCua?: string;

  @IsOptional()
  @IsString()
  giaCa?: string;

  @IsOptional()
  @IsString()
  tags?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lon?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  diemKhongGian?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  diemViTri?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  diemChatLuong?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  diemPhucVu?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  diemGiaCa?: number;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  urlGoc?: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  moTa?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsIn(['open', 'closed', 'pending'])
  status?: 'open' | 'closed' | 'pending';

  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;
}
