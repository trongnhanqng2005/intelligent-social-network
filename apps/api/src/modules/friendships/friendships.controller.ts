import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { AuthSessionGuard, CurrentUser, type AuthPrincipal } from '../auth/auth-session.guard.js';
import { FriendshipException } from './friendships.errors.js';
import {
  CreateFriendshipRequestDto,
  FriendshipIdParamsDto,
  FriendshipMemberIdParamsDto,
  FriendshipRequestIdParamsDto,
  FriendshipRequestsQueryDto,
  FriendshipsQueryDto,
} from './friendships.dto.js';
import { FriendshipsService } from './friendships.service.js';

type FriendshipActionRequest = Request & { friendshipRawBody?: Buffer };

@Controller('friendships')
@UseGuards(AuthSessionGuard)
export class FriendshipsController {
  constructor(private readonly friendships: FriendshipsService) {}

  @Post('requests')
  @Header('Cache-Control', 'no-store')
  createRequest(@CurrentUser() user: AuthPrincipal, @Body() body: CreateFriendshipRequestDto) {
    return this.friendships.createRequest(user.id, body.recipientId, randomUUID(), new Date().toISOString());
  }

  @Get('requests')
  @Header('Cache-Control', 'no-store')
  listRequests(@CurrentUser() user: AuthPrincipal, @Query() query: FriendshipRequestsQueryDto) {
    return this.friendships.listRequests(user.id, query);
  }

  @Post('requests/:requestId/accept')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  acceptRequest(
    @CurrentUser() user: AuthPrincipal,
    @Param() params: FriendshipRequestIdParamsDto,
    @Req() request: FriendshipActionRequest,
  ) {
    assertEmptyActionBody(request);
    return this.friendships.actOnRequest(user.id, params.requestId, 'accept', randomUUID(), new Date().toISOString());
  }

  @Post('requests/:requestId/reject')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  rejectRequest(
    @CurrentUser() user: AuthPrincipal,
    @Param() params: FriendshipRequestIdParamsDto,
    @Req() request: FriendshipActionRequest,
  ) {
    assertEmptyActionBody(request);
    return this.friendships.actOnRequest(user.id, params.requestId, 'reject', randomUUID(), new Date().toISOString());
  }

  @Post('requests/:requestId/cancel')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  cancelRequest(
    @CurrentUser() user: AuthPrincipal,
    @Param() params: FriendshipRequestIdParamsDto,
    @Req() request: FriendshipActionRequest,
  ) {
    assertEmptyActionBody(request);
    return this.friendships.actOnRequest(user.id, params.requestId, 'cancel', randomUUID(), new Date().toISOString());
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  listFriends(@CurrentUser() user: AuthPrincipal, @Query() query: FriendshipsQueryDto) {
    return this.friendships.listFriends(user.id, query);
  }

  @Delete(':friendshipId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  async unfriend(
    @CurrentUser() user: AuthPrincipal,
    @Param() params: FriendshipIdParamsDto,
    @Req() request: Request,
  ): Promise<void> {
    if (hasRequestBody(request)) {
      throw new FriendshipException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_ERROR',
        'Yêu cầu hủy kết bạn không được có nội dung.',
      );
    }
    await this.friendships.unfriend(user.id, params.friendshipId);
  }

  @Get('status/:memberId')
  @Header('Cache-Control', 'no-store')
  getRelationship(@CurrentUser() user: AuthPrincipal, @Param() params: FriendshipMemberIdParamsDto) {
    return this.friendships.getRelationship(user.id, params.memberId);
  }
}

function hasRequestBody(request: Request): boolean {
  const contentLength = Number(request.get('content-length') ?? 0);
  return contentLength > 0 || Boolean(request.get('transfer-encoding'));
}

function assertEmptyActionBody(request: FriendshipActionRequest): void {
  const body: unknown = request.body;
  const rawBodyLength = request.friendshipRawBody?.length ?? 0;
  if (rawBodyLength > 0 && body !== null && typeof body === 'object' &&
      !Array.isArray(body) && Object.keys(body).length === 0) return;
  throw new FriendshipException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'VALIDATION_ERROR',
    'Dữ liệu không hợp lệ.',
  );
}
