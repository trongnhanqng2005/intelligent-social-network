import { HttpStatus, Injectable } from '@nestjs/common';
import { ProfileValidationError } from '../../domain/user-profile.js';
import { AuthRateLimiter } from '../auth/rate-limiter.js';
import {
  decodeFriendshipCursor,
  encodeFriendshipCursor,
  parseFriendshipLimit,
  type FriendshipRequestDirection,
} from './friendship-pagination.js';
import { FriendshipException } from './friendships.errors.js';
import { FriendshipsRepository } from './friendships.repository.js';
import type { FriendshipRequestAction, RepositoryMutationOutcome } from './friendships.types.js';

@Injectable()
export class FriendshipsService {
  private readonly limiter = new AuthRateLimiter();

  constructor(private readonly repository: FriendshipsRepository) {}

  async createRequest(senderId: string, recipientId: string, requestId: string, now: string) {
    this.consumeMutation(senderId);
    const outcome = await this.repository.createRequest({ senderId, recipientId, requestId, now });
    if (outcome.kind === 'not-found') {
      throw new FriendshipException(HttpStatus.NOT_FOUND, 'MEMBER_NOT_FOUND', 'Không tìm thấy thành viên.');
    }
    return resolveMutation(outcome);
  }

  async actOnRequest(
    actorId: string,
    requestId: string,
    action: FriendshipRequestAction,
    friendshipId: string,
    now: string,
  ) {
    this.consumeMutation(actorId);
    return resolveMutation(await this.repository.actOnRequest({
      actorId, requestId, action, friendshipId, now,
    }));
  }

  async listRequests(viewerId: string, input: { direction?: unknown; limit?: unknown; cursor?: unknown }) {
    this.consumeRead(viewerId);
    const direction = parseDirection(input.direction);
    const limit = parseLimit(input.limit);
    const afterId = parseCursor(input.cursor, {
      scope: 'requests', viewerId, direction,
    });
    const results = await this.repository.listRequests({
      viewerId,
      direction,
      ...(afterId ? { afterId } : {}),
      fetchLimit: limit + 1,
    });
    const hasMore = results.length > limit;
    const items = results.slice(0, limit);
    return {
      items,
      pagination: {
        limit,
        hasMore,
        nextCursor: hasMore && items.length
          ? encodeFriendshipCursor({ scope: 'requests', viewerId, direction, lastId: items.at(-1)!.request.id })
          : null,
      },
    };
  }

  async listFriends(viewerId: string, input: { limit?: unknown; cursor?: unknown }) {
    this.consumeRead(viewerId);
    const limit = parseLimit(input.limit);
    const afterId = parseCursor(input.cursor, { scope: 'friends', viewerId });
    const results = await this.repository.listFriends({
      viewerId,
      ...(afterId ? { afterId } : {}),
      fetchLimit: limit + 1,
    });
    const hasMore = results.length > limit;
    const items = results.slice(0, limit);
    return {
      items,
      pagination: {
        limit,
        hasMore,
        nextCursor: hasMore && items.length
          ? encodeFriendshipCursor({ scope: 'friends', viewerId, lastId: items.at(-1)!.member.id })
          : null,
      },
    };
  }

  async getRelationship(viewerId: string, memberId: string) {
    this.consumeRead(viewerId);
    const result = await this.repository.getRelationship(viewerId, memberId);
    if (result.kind === 'not-found') {
      throw new FriendshipException(HttpStatus.NOT_FOUND, 'MEMBER_NOT_FOUND', 'Không tìm thấy thành viên.');
    }
    return { relationship: result.relationship };
  }

  async unfriend(actorId: string, friendshipId: string): Promise<void> {
    this.consumeMutation(actorId);
    await this.repository.unfriend(actorId, friendshipId);
  }

  private consumeRead(userId: string): void {
    this.consume('friendship-read', userId, 120);
  }

  private consumeMutation(userId: string): void {
    this.consume('friendship-write', userId, 20);
  }

  private consume(scope: string, userId: string, limit: number): void {
    const retryAfterSeconds = this.limiter.consume(AuthRateLimiter.identityKey(scope, userId), limit, 60_000);
    if (retryAfterSeconds > 0) {
      throw new FriendshipException(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        'Bạn đã thực hiện quá nhiều yêu cầu. Vui lòng thử lại sau.',
        undefined,
        retryAfterSeconds,
      );
    }
  }
}

function resolveMutation(outcome: RepositoryMutationOutcome) {
  if (outcome.kind === 'success') return outcome.result;
  if (outcome.kind === 'not-found') {
    throw new FriendshipException(HttpStatus.NOT_FOUND, 'REQUEST_NOT_FOUND', 'Không tìm thấy lời mời kết bạn.');
  }
  if (outcome.kind === 'forbidden') {
    throw new FriendshipException(HttpStatus.FORBIDDEN, 'FRIENDSHIP_ACTION_FORBIDDEN', 'Bạn không thể thực hiện thao tác này.');
  }
  switch (outcome.reason) {
    case 'self':
      throw new FriendshipException(HttpStatus.CONFLICT, 'SELF_FRIENDSHIP', 'Bạn không thể kết bạn với chính mình.');
    case 'same-pending':
      throw new FriendshipException(HttpStatus.CONFLICT, 'REQUEST_ALREADY_PENDING', 'Bạn đã gửi lời mời đang chờ phản hồi.');
    case 'incoming-pending':
      throw new FriendshipException(HttpStatus.CONFLICT, 'INCOMING_REQUEST_EXISTS', 'Bạn đã nhận lời mời từ thành viên này. Hãy chấp nhận hoặc từ chối.');
    case 'already-friends':
      throw new FriendshipException(HttpStatus.CONFLICT, 'ALREADY_FRIENDS', 'Hai bạn đã là bạn bè.');
    case 'state':
      throw new FriendshipException(HttpStatus.CONFLICT, 'FRIENDSHIP_STATE_CONFLICT', 'Trạng thái lời mời đã thay đổi. Hãy tải lại trước khi thử tiếp.');
  }
}

function parseDirection(value: unknown): FriendshipRequestDirection {
  if (value === 'received' || value === 'sent') return value;
  throw new FriendshipException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'VALIDATION_ERROR',
    'Dữ liệu không hợp lệ.',
    { direction: ['Chọn received hoặc sent.'] },
  );
}

function parseLimit(value: unknown): number {
  try {
    return parseFriendshipLimit(value);
  } catch (error) {
    throw validationException(error, 'limit');
  }
}

function parseCursor(
  value: unknown,
  expected: Parameters<typeof decodeFriendshipCursor>[1],
): string | undefined {
  try {
    return decodeFriendshipCursor(value, expected);
  } catch (error) {
    throw validationException(error, 'cursor');
  }
}

function validationException(error: unknown, fallbackField: string): FriendshipException {
  if (error instanceof FriendshipException) return error;
  if (error instanceof ProfileValidationError) {
    return new FriendshipException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'VALIDATION_ERROR',
      'Dữ liệu không hợp lệ.',
      { [error.field]: [error.message] },
    );
  }
  return new FriendshipException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'VALIDATION_ERROR',
    'Dữ liệu không hợp lệ.',
    { [fallbackField]: ['Giá trị không hợp lệ.'] },
  );
}
