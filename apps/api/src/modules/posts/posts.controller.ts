import { Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Param, Patch, Post as HttpPost, Query, UseGuards } from '@nestjs/common';
import { AuthSessionGuard, CurrentUser, type AuthPrincipal } from '../auth/auth-session.guard.js';
import { CommentDto, CreatePostDto, PostCommentParamsDto, PostIdParamsDto, PostsQueryDto, UpdatePostDto } from './posts.dto.js';
import { PostsService } from './posts.service.js';

@Controller('posts')
@UseGuards(AuthSessionGuard)
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get('feed')
  @Header('Cache-Control', 'no-store')
  feed(@CurrentUser() user: AuthPrincipal, @Query() query: PostsQueryDto) {
    return this.posts.feed(user.id, query);
  }

  @HttpPost()
  @Header('Cache-Control', 'no-store')
  create(@CurrentUser() user: AuthPrincipal, @Body() body: CreatePostDto) {
    return this.posts.create(user.id, body.content);
  }

  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  update(@CurrentUser() user: AuthPrincipal, @Param() params: PostIdParamsDto, @Body() body: UpdatePostDto) {
    return this.posts.update(user.id, params.id, body.content);
  }

  @HttpPost(':id/like')
  @Header('Cache-Control', 'no-store')
  like(@CurrentUser() user: AuthPrincipal, @Param() params: PostIdParamsDto) {
    return this.posts.toggleLike(user.id, params.id, true);
  }

  @Delete(':id/like')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  unlike(@CurrentUser() user: AuthPrincipal, @Param() params: PostIdParamsDto) {
    return this.posts.toggleLike(user.id, params.id, false);
  }

  @HttpPost(':id/share')
  @Header('Cache-Control', 'no-store')
  share(@CurrentUser() user: AuthPrincipal, @Param() params: PostIdParamsDto) {
    return this.posts.toggleShare(user.id, params.id, true);
  }

  @Delete(':id/share')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  unshare(@CurrentUser() user: AuthPrincipal, @Param() params: PostIdParamsDto) {
    return this.posts.toggleShare(user.id, params.id, false);
  }

  @Get(':id/comments')
  @Header('Cache-Control', 'no-store')
  comments(@CurrentUser() user: AuthPrincipal, @Param() params: PostIdParamsDto) {
    return this.posts.listComments(user.id, params.id);
  }

  @HttpPost(':id/comments')
  @Header('Cache-Control', 'no-store')
  comment(@CurrentUser() user: AuthPrincipal, @Param() params: PostIdParamsDto, @Body() body: CommentDto) {
    return this.posts.createComment(user.id, params.id, body.content);
  }

  @Delete(':id/comments/:commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  async removeComment(@CurrentUser() user: AuthPrincipal, @Param() params: PostCommentParamsDto): Promise<void> {
    await this.posts.removeComment(user.id, params.commentId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  async remove(@CurrentUser() user: AuthPrincipal, @Param() params: PostIdParamsDto): Promise<void> {
    await this.posts.remove(user.id, params.id);
  }
}
