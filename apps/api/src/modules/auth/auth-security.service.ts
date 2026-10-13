import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { doubleCsrf, type DoubleCsrfUtilities } from 'csrf-csrf';
import type { Request, Response } from 'express';
import { resolveAuthPath } from './auth-path.js';

declare module 'express-serve-static-core' {
  interface Request {
    authCsrfIdentifier?: string;
  }
}

const SESSION_TTL_MS = 86_400_000;

@Injectable()
export class AuthSecurityService implements OnModuleInit {
  readonly production: boolean;
  readonly sessionCookieName: string;
  readonly csrfContextCookieName: string;
  private csrfCookieName: string;
  private secret = '';
  private csrf!: DoubleCsrfUtilities;

  constructor(config: ConfigService) {
    this.production = config.getOrThrow<string>('NODE_ENV') === 'production';
    this.sessionCookieName = this.production ? '__Host-isn_session' : 'isn_session';
    this.csrfCookieName = this.production ? '__Host-isn_csrf' : 'isn_csrf';
    this.csrfContextCookieName = this.production ? '__Host-isn_csrf_context' : 'isn_csrf_context';
    this.csrfSecretPath = resolveAuthPath(config.getOrThrow<string>('AUTH_CSRF_SECRET_PATH'));
  }

  private readonly csrfSecretPath: string;

  async onModuleInit(): Promise<void> {
    const secret = await readFile(this.csrfSecretPath);
    if (secret.byteLength < 32) throw new Error('Authentication CSRF secret must contain at least 32 random bytes');
    this.secret = secret.toString('base64url');
    this.csrf = doubleCsrf({
      getSecret: () => this.secret,
      getSessionIdentifier: (request) => this.identifier(request),
      cookieName: this.csrfCookieName,
      cookieOptions: this.cookieOptions(SESSION_TTL_MS),
      getCsrfTokenFromRequest: (request) => {
        const value = request.headers['x-csrf-token'];
        return typeof value === 'string' ? value : undefined;
      },
      errorConfig: { statusCode: 403, message: 'CSRF validation failed', code: 'CSRF_FAILED' },
    });
  }

  middleware() {
    return (request: Request, response: Response, next: (error?: unknown) => void) => {
      if (!this.csrf) return next(new Error('CSRF protection is not initialized'));
      this.csrf.doubleCsrfProtection(request, response, next);
    };
  }

  bootstrap(request: Request, response: Response): string {
    const sessionToken = request.cookies?.[this.sessionCookieName];
    if (typeof sessionToken === 'string' && sessionToken) {
      request.authCsrfIdentifier = `session:${sessionToken}`;
    } else {
      const existingNonce = request.cookies?.[this.csrfContextCookieName];
      const nonce = typeof existingNonce === 'string' && existingNonce
        ? existingNonce
        : randomBytes(32).toString('base64url');
      if (nonce !== existingNonce) response.cookie(this.csrfContextCookieName, nonce, this.cookieOptions(SESSION_TTL_MS));
      request.authCsrfIdentifier = `anonymous:${nonce}`;
    }
    return this.csrf.generateCsrfToken(request, response);
  }

  issueSession(request: Request, response: Response, token: string): string {
    response.cookie(this.sessionCookieName, token, this.cookieOptions(SESSION_TTL_MS));
    response.clearCookie(this.csrfContextCookieName, this.cookieOptions());
    request.authCsrfIdentifier = `session:${token}`;
    return this.csrf.generateCsrfToken(request, response, { overwrite: true });
  }

  clearSessionAndRotate(request: Request, response: Response): void {
    response.clearCookie(this.sessionCookieName, this.cookieOptions());
    const nonce = randomBytes(32).toString('base64url');
    response.cookie(this.csrfContextCookieName, nonce, this.cookieOptions(SESSION_TTL_MS));
    request.authCsrfIdentifier = `anonymous:${nonce}`;
    this.csrf.generateCsrfToken(request, response, { overwrite: true });
  }

  private identifier(request: Request): string {
    if (request.authCsrfIdentifier) return request.authCsrfIdentifier;
    const sessionToken = request.cookies?.[this.sessionCookieName];
    if (typeof sessionToken === 'string' && sessionToken) return `session:${sessionToken}`;
    const nonce = request.cookies?.[this.csrfContextCookieName];
    return `anonymous:${typeof nonce === 'string' && nonce ? nonce : 'uninitialized'}`;
  }

  private cookieOptions(maxAge?: number) {
    return {
      httpOnly: true,
      secure: this.production,
      sameSite: 'lax' as const,
      path: '/',
      ...(maxAge ? { maxAge } : {}),
    };
  }
}
