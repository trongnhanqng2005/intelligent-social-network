import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AccountConflictError, AuthRepository } from './auth.repository.js';
import { AuthException } from './auth.errors.js';
import { normalizeEmail, validatePassword } from './identity.js';
import { JwtService } from './jwt.service.js';
import { AuthRateLimiter } from './rate-limiter.js';
import { PasswordService } from './password.service.js';

const SESSION_TTL_MS = 86_400_000;

@Injectable()
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
  ) {}

  private readonly limiter = new AuthRateLimiter();

  async register(emailInput: string, passwordInput: string, clientIp: string) {
    const email = this.normalizedEmail(emailInput);
    const password = this.validPassword(passwordInput);
    this.enforceLimit(AuthRateLimiter.identityKey('register-ip', clientIp), 5, 3_600_000);
    const passwordHash = await this.passwords.hash(password);
    const now = currentTimestamp();
    try {
      return await this.repository.register({
        id: randomUUID(), email, passwordHash, eventId: randomUUID(), now: now.iso,
      });
    } catch (error) {
      if (error instanceof AccountConflictError) {
        throw new AuthException(
          HttpStatus.CONFLICT,
          'REGISTRATION_CONFLICT',
          'Không thể tạo tài khoản với thông tin này.',
        );
      }
      throw error;
    }
  }

  async login(emailInput: string, passwordInput: string, clientIp: string) {
    const email = this.normalizedEmail(emailInput);
    const password = this.validPassword(passwordInput);
    this.enforceLimit(AuthRateLimiter.identityKey('login-ip', clientIp), 20, 900_000);
    this.enforceLimit(AuthRateLimiter.identityKey(`login-identity:${clientIp}`, email), 10, 900_000);

    const credentials = await this.repository.findCredentials(email);
    if (!credentials) {
      await this.passwords.dummyVerify(password);
      await this.recordFailure(email);
      throw invalidCredentials();
    }
    if (!await this.passwords.verify(credentials.passwordHash, password)) {
      await this.recordFailure(email);
      throw invalidCredentials();
    }

    const replacementPasswordHash = this.passwords.needsRehash(credentials.passwordHash)
      ? await this.passwords.hash(password)
      : undefined;
    const now = currentTimestamp();
    const sessionId = randomUUID();
    const jti = randomUUID();
    const expiresAt = new Date(now.millis + SESSION_TTL_MS).toISOString();
    const token = await this.jwt.signSession(credentials.id, jti, now.epochSeconds);
    const created = await this.repository.createSession({
      user: { id: credentials.id, email: credentials.email },
      expectedPasswordHash: credentials.passwordHash,
      replacementPasswordHash,
      id: sessionId,
      jti,
      eventId: randomUUID(),
      now: now.iso,
      expiresAt,
    });
    if (!created) {
      await this.recordFailure(email);
      throw invalidCredentials();
    }
    return {
      user: { id: credentials.id, email: credentials.email },
      token,
      issuedAt: now.iso,
      expiresAt,
    };
  }

  async restoreSession(token: string): Promise<{
    user: { id: string; email: string };
    jti: string;
    expiresAt: string;
  } | undefined> {
    let claims;
    try {
      claims = await this.jwt.verifySessionToken(token);
    } catch {
      return undefined;
    }
    const session = await this.repository.findActiveSession(
      claims.sub,
      claims.jti,
      new Date(claims.exp * 1000).toISOString(),
    );
    if (!session) return undefined;
    return {
      user: { id: session.id, email: session.email },
      jti: claims.jti,
      expiresAt: session.expiresAt,
    };
  }

  async logout(token: string): Promise<boolean> {
    let claims;
    try {
      claims = await this.jwt.verifySessionToken(token);
    } catch {
      return false;
    }
    return this.repository.revokeSession({
      userId: claims.sub,
      jti: claims.jti,
      eventId: randomUUID(),
      now: currentTimestamp().iso,
    });
  }

  rateLimitCsrf(clientIp: string): void {
    this.enforceLimit(AuthRateLimiter.identityKey('csrf-ip', clientIp), 60, 60_000);
  }

  private normalizedEmail(input: string): string {
    try {
      return normalizeEmail(input);
    } catch {
      throw new AuthException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', {
        email: ['Vui lòng nhập địa chỉ email hợp lệ.'],
      });
    }
  }

  private validPassword(input: string): string {
    try {
      return validatePassword(input);
    } catch {
      throw new AuthException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', {
        password: ['Mật khẩu phải có từ 15 đến 128 ký tự.'],
      });
    }
  }

  private enforceLimit(key: string, limit: number, windowMs: number): void {
    const retryAfterSeconds = this.limiter.consume(key, limit, windowMs);
    if (retryAfterSeconds > 0) {
      throw new AuthException(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        'Bạn đã thử quá nhiều lần. Vui lòng chờ rồi thử lại.',
        undefined,
        retryAfterSeconds,
      );
    }
  }

  private async recordFailure(email: string): Promise<void> {
    await this.repository.recordLoginFailure(email, randomUUID(), currentTimestamp().iso);
  }
}

function invalidCredentials(): AuthException {
  return new AuthException(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng.');
}

function currentTimestamp() {
  const millis = Math.floor(Date.now() / 1000) * 1000;
  return {
    millis,
    epochSeconds: millis / 1000,
    iso: new Date(millis).toISOString(),
  };
}
