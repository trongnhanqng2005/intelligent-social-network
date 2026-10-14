import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class CreateFriendshipRequestDto {
  @Transform(({ value }) => typeof value === 'string' ? value.toLowerCase() : value)
  @IsUUID('all')
  recipientId!: string;
}

export class FriendshipRequestIdParamsDto {
  @Transform(({ value }) => typeof value === 'string' ? value.toLowerCase() : value)
  @IsUUID('all')
  requestId!: string;
}

export class FriendshipIdParamsDto {
  @Transform(({ value }) => typeof value === 'string' ? value.toLowerCase() : value)
  @IsUUID('all')
  friendshipId!: string;
}

export class FriendshipMemberIdParamsDto {
  @Transform(({ value }) => typeof value === 'string' ? value.toLowerCase() : value)
  @IsUUID('all')
  memberId!: string;
}

export class FriendshipRequestsQueryDto {
  @IsIn(['received', 'sent'])
  direction!: 'received' | 'sent';

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

export class FriendshipsQueryDto {
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
