import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength } from 'class-validator';

export class AuthCredentialsDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString({ message: 'Vui lòng nhập địa chỉ email.' })
  @MaxLength(254, { message: 'Email không được vượt quá 254 ký tự.' })
  @IsEmail({}, { message: 'Vui lòng nhập địa chỉ email hợp lệ.' })
  email!: string;

  @IsString({ message: 'Vui lòng nhập mật khẩu.' })
  @MaxLength(512, { message: 'Mật khẩu vượt quá giới hạn cho phép.' })
  password!: string;
}
