import { HttpException, HttpStatus } from '@nestjs/common';

export type FriendshipErrorCode =
  | 'VALIDATION_ERROR'
  | 'MEMBER_NOT_FOUND'
  | 'REQUEST_NOT_FOUND'
  | 'FRIENDSHIP_ACTION_FORBIDDEN'
  | 'SELF_FRIENDSHIP'
  | 'REQUEST_ALREADY_PENDING'
  | 'INCOMING_REQUEST_EXISTS'
  | 'ALREADY_FRIENDS'
  | 'FRIENDSHIP_STATE_CONFLICT'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE';

export class FriendshipException extends HttpException {
  constructor(
    status: HttpStatus,
    code: FriendshipErrorCode,
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
    readonly retryAfterSeconds?: number,
  ) {
    super({ error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } }, status);
  }
}

export function friendshipValidationError(field: string, message: string): FriendshipException {
  return new FriendshipException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'VALIDATION_ERROR',
    'Dữ liệu không hợp lệ.',
    { [field]: [message] },
  );
}
