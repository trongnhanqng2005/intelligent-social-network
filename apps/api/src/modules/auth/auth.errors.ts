import { HttpException, HttpStatus } from '@nestjs/common';

export type AuthErrorCode =
  | 'VALIDATION_ERROR'
  | 'REGISTRATION_CONFLICT'
  | 'ALREADY_AUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'UNAUTHENTICATED'
  | 'CSRF_FAILED'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export class AuthException extends HttpException {
  constructor(
    status: HttpStatus,
    code: AuthErrorCode,
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
    readonly retryAfterSeconds?: number,
  ) {
    super({ error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } }, status);
  }
}

export function unavailableError(): AuthException {
  return new AuthException(
    HttpStatus.SERVICE_UNAVAILABLE,
    'SERVICE_UNAVAILABLE',
    'Dịch vụ tạm thời không khả dụng. Vui lòng thử lại.',
  );
}
