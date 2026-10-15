import { HttpException, HttpStatus } from '@nestjs/common';

export type PostErrorCode =
  | 'VALIDATION_ERROR'
  | 'POST_NOT_FOUND'
  | 'POST_FORBIDDEN'
  | 'COMMENT_NOT_FOUND'
  | 'COMMENT_FORBIDDEN'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE';

export class PostException extends HttpException {
  constructor(
    status: HttpStatus,
    code: PostErrorCode,
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
    readonly retryAfterSeconds?: number,
  ) {
    super({ error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } }, status);
  }
}
