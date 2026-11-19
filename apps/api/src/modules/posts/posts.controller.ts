import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthSessionGuard, CurrentUser, type AuthPrincipal } from '../auth/auth-session.guard.js';
import { PostsException } from './posts.errors.js';
import { CommentCreateDto, CommentDeleteQueryDto, CommentIdParamsDto, CommentsListQueryDto, CreatePostDto, DeletePostQueryDto, PostIdParamsDto, UpdatePostDto } from './posts.dto.js';
import { PostsService } from './posts.service.js';

@Controller('posts')
@UseGuards(AuthSessionGuard)
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  create(@CurrentUser() user: AuthPrincipal, @Body() body: CreatePostDto) {
    return this.posts.create(user.id, body);
  }

  @Get(':postId')
  @Header('Cache-Control', 'no-store')
  get(@CurrentUser() user: AuthPrincipal, @Param() params: PostIdParamsDto) {
    return this.posts.getPost(user.id, params.postId);
  }

  @Patch(':postId')
  @Header('Cache-Control', 'no-store')
  update(
    @CurrentUser() user: AuthPrincipal,
    @Param() params: PostIdParamsDto,
    @Body() body: UpdatePostDto,
  ) {
    return this.posts.update(user.id, params.postId, body);
  }

  @Delete(':postId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  async delete(
    @CurrentUser() user: AuthPrincipal,
    @Param() params: PostIdParamsDto,
    @Query() query: DeletePostQueryDto,
    @Req() request: Request,
  ): Promise<void> {
    if (hasRequestBody(request)) {
      throw new PostsException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', 'Yêu cầu xóa bài viết không được có nội dung.');
    }
    await this.posts.delete(user.id, params.postId, query.expectedVersion);
  }

  @Put(':postId/like')
  @Header('Cache-Control', 'no-store')
  like(@CurrentUser() user: AuthPrincipal, @Param() params: PostIdParamsDto) {
    return this.posts.like(user.id, params.postId);
  }

  @Delete(':postId/like')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  async unlike(@CurrentUser() user: AuthPrincipal, @Param() params: PostIdParamsDto): Promise<void> {
    await this.posts.unlike(user.id, params.postId);
  }

  @Get(':postId/comments')
  @Header('Cache-Control', 'no-store')
  comments(@CurrentUser() user: AuthPrincipal, @Param() params: PostIdParamsDto, @Query() query: CommentsListQueryDto) {
    return this.posts.listComments(user.id, params.postId, query);
  }

  @Post(':postId/comments')
  @Header('Cache-Control', 'no-store')
  createComment(@CurrentUser() user: AuthPrincipal, @Param() params: PostIdParamsDto, @Body() body: CommentCreateDto) {
    return this.posts.createComment(user.id, params.postId, body);
  }

  @Patch(':postId/comments/:commentId')
  @Header('Cache-Control', 'no-store')
  updateComment(@CurrentUser() user: AuthPrincipal, @Param() params: CommentIdParamsDto, @Body() body: UpdatePostDto) {
    return this.posts.updateComment(user.id, params.postId, params.commentId, body);
  }

  @Delete(':postId/comments/:commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  async deleteComment(@CurrentUser() user: AuthPrincipal, @Param() params: CommentIdParamsDto, @Query() query: CommentDeleteQueryDto): Promise<void> {
    await this.posts.deleteComment(user.id, params.postId, params.commentId, query.expectedVersion);
  }
}

function hasRequestBody(request: Request): boolean {
  const contentLength = Number(request.get('content-length') ?? 0);
  return contentLength > 0 || Boolean(request.get('transfer-encoding'));
}
