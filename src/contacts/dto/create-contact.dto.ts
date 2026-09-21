import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { ContactTopic } from '../schemas/contact.schema';

export class CreateContactDto {
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập Họ và tên' })
  @MinLength(2, { message: 'Họ và tên phải có ít nhất 2 ký tự' })
  name: string;

  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập Số điện thoại' })
  @Matches(/^(0[3|5|7|8|9])[0-9]{8}$/, { message: 'Số điện thoại không hợp lệ (VD: 0912345678)' })
  phone: string;

  @IsEmail({}, { message: 'Địa chỉ Email không hợp lệ' })
  @IsNotEmpty({ message: 'Vui lòng nhập Email' })
  email: string;

  @IsEnum(ContactTopic, { message: 'Chủ đề liên hệ không hợp lệ' })
  @IsNotEmpty({ message: 'Vui lòng chọn Chủ đề' })
  topic: string;

  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập Nội dung liên hệ' })
  @MinLength(10, { message: 'Nội dung phản hồi phải có ít nhất 10 ký tự' })
  message: string;

  @IsOptional()
  @IsString()
  topicText?: string;
}
