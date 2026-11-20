import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { AuthException } from './auth.errors.js';
import type { AuthenticatedRequest } from './auth-session.guard.js';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.authPrincipal?.role === 'ADMIN') return true;
    if (!request.authPrincipal) {
      throw new AuthException(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Vui lòng đăng nhập để tiếp tục.');
    }
    throw new AuthException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Bạn không có quyền truy cập.');
  }
}
