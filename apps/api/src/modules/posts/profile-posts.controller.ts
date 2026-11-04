import { Controller, Get, Header, Param, Query, UseGuards } from '@nestjs/common';
import { AuthSessionGuard, CurrentUser, type AuthPrincipal } from '../auth/auth-session.guard.js';
import { MemberPostsParamsDto, PostsListQueryDto } from './posts.dto.js';
import { PostsService } from './posts.service.js';

@Controller('users')
@UseGuards(AuthSessionGuard)
export class ProfilePostsController {
  constructor(private readonly posts: PostsService) {}

  @Get(':memberId/posts')
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentUser() user: AuthPrincipal,
    @Param() params: MemberPostsParamsDto,
    @Query() query: PostsListQueryDto,
  ) {
    return this.posts.listProfile(user.id, params.memberId, query);
  }
}
