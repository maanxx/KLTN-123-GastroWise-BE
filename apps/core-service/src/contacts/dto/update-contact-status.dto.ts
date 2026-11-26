import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateContactStatusDto {
  @IsNotEmpty()
  @IsIn(['CHỜ XỬ LÝ', 'ĐANG XỬ LÝ', 'ĐÃ GIẢI QUYẾT'])
  status: 'CHỜ XỬ LÝ' | 'ĐANG XỬ LÝ' | 'ĐÃ GIẢI QUYẾT';

  @IsOptional()
  @IsString()
  resolvedBy?: string;
}
