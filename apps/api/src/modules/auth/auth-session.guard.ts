import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthException } from './auth.errors.js';
import { AuthService } from './auth.service.js';
import { AuthSecurityService } from './auth-security.service.js';

export interface AuthPrincipal {
  id: string;
  email: string;
  jti: string;
  expiresAt: string;
}

export interface AuthenticatedRequest extends Request {
  authPrincipal?: AuthPrincipal;
}

@Injectable()
export class AuthSessionGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly security: AuthSecurityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();
    const token = request.cookies?.[this.security.sessionCookieName];
    if (typeof token !== 'string' || !token) throw unauthenticated();
    const session = await this.auth.restoreSession(token);
    if (!session) {
      this.security.clearSessionAndRotate(request, response);
      throw unauthenticated();
    }
    request.authPrincipal = {
      id: session.user.id,
      email: session.user.email,
      jti: session.jti,
      expiresAt: session.expiresAt,
    };
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthPrincipal =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().authPrincipal!,
);

function unauthenticated(): AuthException {
  return new AuthException(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Vui lòng đăng nhập để tiếp tục.');
}
