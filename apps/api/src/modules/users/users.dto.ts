import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export class UpdateOwnProfileDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  displayName?: string;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  bio?: string | null;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  location?: string | null;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedVersion!: number;
}

export class UserIdParamsDto {
  @IsUUID('all')
  id!: string;
}

export class UsersQueryDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  q?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}
