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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthSessionGuard, CurrentUser, type AuthPrincipal } from '../auth/auth-session.guard.js';
import { PostsException } from './posts.errors.js';
import { CreatePostDto, DeletePostQueryDto, PostIdParamsDto, UpdatePostDto } from './posts.dto.js';
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
}

function hasRequestBody(request: Request): boolean {
  const contentLength = Number(request.get('content-length') ?? 0);
  return contentLength > 0 || Boolean(request.get('transfer-encoding'));
}
