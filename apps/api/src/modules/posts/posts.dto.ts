import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreatePostDto {
  @IsString()
  @MaxLength(2000)
  content!: string;
}

export class UpdatePostDto {
  @IsString()
  @MaxLength(2000)
  content!: string;
}

export class PostIdParamsDto {
  @Transform(({ value }) => typeof value === 'string' ? value.toLowerCase() : value)
  @IsUUID('all')
  id!: string;
}

export class PostsQueryDto {
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

export class CommentDto {
  @IsString()
  @MaxLength(1000)
  content!: string;
}

export class CommentIdParamsDto {
  @Transform(({ value }) => typeof value === 'string' ? value.toLowerCase() : value)
  @IsUUID('all')
  commentId!: string;
}

export class PostCommentParamsDto extends PostIdParamsDto {
  @Transform(({ value }) => typeof value === 'string' ? value.toLowerCase() : value)
  @IsUUID('all')
  commentId!: string;
}
