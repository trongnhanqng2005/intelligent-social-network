import { HttpException, HttpStatus } from '@nestjs/common';

export type PostsErrorCode =
  | 'VALIDATION_ERROR'
  | 'MEMBER_NOT_FOUND'
  | 'POST_NOT_FOUND'
  | 'POST_ACTION_FORBIDDEN'
  | 'POST_CONFLICT'
  | 'POST_DATA_INCONSISTENT'
  | 'WRITE_OUTCOME_UNKNOWN'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE';

export class PostsException extends HttpException {
  constructor(
    status: HttpStatus,
    code: PostsErrorCode,
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
    readonly retryAfterSeconds?: number,
  ) {
    super({ error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } }, status);
  }
}

export class PostGraphInvariantError extends Error {
  constructor() {
    super('Post graph invariants are inconsistent');
    this.name = 'PostGraphInvariantError';
  }
}
