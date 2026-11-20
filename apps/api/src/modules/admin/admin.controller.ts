import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { AuthSessionGuard, CurrentUser, type AuthPrincipal } from '../auth/auth-session.guard.js';
import { AdminGuard } from '../auth/admin.guard.js';
import { AdminService } from './admin.service.js';

class ListQueryDto {
  @IsOptional() @IsString() @MaxLength(200) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset = 0;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
}
export class MemberListQueryDto extends ListQueryDto {
  @IsOptional() @IsIn(['all', 'active', 'locked']) state: string = 'all';
}
export class ContentListQueryDto extends ListQueryDto {
  @IsOptional() @IsIn(['all', 'visible', 'hidden']) state: string = 'all';
}
export class AdminIdParamsDto {
  @IsUUID('4') id!: string;
}
export class LockMemberDto {
  @IsBoolean() locked!: boolean;
}
export class VisibilityDto {
  @IsBoolean() hidden!: boolean;
}

@Controller('admin')
@UseGuards(AuthSessionGuard, AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('members')
  members(@Query() query: MemberListQueryDto) { return this.admin.members(query); }

  @Get('posts')
  posts(@Query() query: ContentListQueryDto) { return this.admin.posts(query); }

  @Get('comments')
  comments(@Query() query: ContentListQueryDto) { return this.admin.comments(query); }

  @Put('members/:id/lock')
  lockMember(@CurrentUser() user: AuthPrincipal, @Param() params: AdminIdParamsDto, @Body() body: LockMemberDto) {
    return this.admin.lockMember(user.id, params.id, body.locked);
  }

  @Put('posts/:id/visibility')
  postVisibility(@CurrentUser() user: AuthPrincipal, @Param() params: AdminIdParamsDto, @Body() body: VisibilityDto) {
    return this.admin.setPostVisibility(user.id, params.id, body.hidden);
  }

  @Put('comments/:id/visibility')
  commentVisibility(@CurrentUser() user: AuthPrincipal, @Param() params: AdminIdParamsDto, @Body() body: VisibilityDto) {
    return this.admin.setCommentVisibility(user.id, params.id, body.hidden);
  }
}
