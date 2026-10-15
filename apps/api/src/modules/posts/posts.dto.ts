import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min, ValidateIf } from 'class-validator';

export class CreatePostDto {
  @IsString()
  content!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['members', 'friends'])
  visibility?: 'members' | 'friends';
}

export class UpdatePostDto {
  @IsString()
  content!: string;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedVersion!: number;
}

export class PostIdParamsDto {
  @Transform(({ value }) => typeof value === 'string' ? value.toLowerCase() : value)
  @IsUUID('all')
  postId!: string;
}

export class MemberPostsParamsDto {
  @Transform(({ value }) => typeof value === 'string' ? value.toLowerCase() : value)
  @IsUUID('all')
  memberId!: string;
}

export class PostsListQueryDto {
  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string;
}

export class DeletePostQueryDto {
  @Transform(({ value }) => typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedVersion!: number;
}
