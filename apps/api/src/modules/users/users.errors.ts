import { HttpException, HttpStatus } from '@nestjs/common';

export type ProfileErrorCode =
  | 'VALIDATION_ERROR'
  | 'PROFILE_NOT_FOUND'
  | 'PROFILE_CONFLICT'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE';

export class ProfileException extends HttpException {
  constructor(
    status: HttpStatus,
    code: ProfileErrorCode,
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
    readonly retryAfterSeconds?: number,
  ) {
    super({ error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } }, status);
  }
}
