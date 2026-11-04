import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { AuthSessionGuard, CurrentUser, type AuthPrincipal } from '../auth/auth-session.guard.js';
import { PostsListQueryDto } from './posts.dto.js';
import { PostsService } from './posts.service.js';

@Controller()
@UseGuards(AuthSessionGuard)
export class FeedController {
  constructor(private readonly posts: PostsService) {}

  @Get('feed')
  @Header('Cache-Control', 'no-store')
  list(@CurrentUser() user: AuthPrincipal, @Query() query: PostsListQueryDto) {
    return this.posts.listFeed(user.id, query);
  }
}
