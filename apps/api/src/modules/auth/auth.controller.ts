import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthException } from './auth.errors.js';
import { AuthCredentialsDto } from './auth.dto.js';
import { AuthService } from './auth.service.js';
import { AuthSecurityService } from './auth-security.service.js';
import { AuthSessionGuard, CurrentUser, type AuthenticatedRequest, type AuthPrincipal } from './auth-session.guard.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly security: AuthSecurityService,
  ) {}

  @Get('csrf')
  @Header('Cache-Control', 'no-store')
  getCsrfToken(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.auth.rateLimitCsrf(clientIp(request));
    return { csrfToken: this.security.bootstrap(request, response) };
  }

  @Post('register')
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() body: AuthCredentialsDto, @Req() request: Request) {
    await this.requireAnonymous(request);
    const user = await this.auth.register(body.email, body.password, clientIp(request));
    return { user };
  }

  @Post('login')
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: AuthCredentialsDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.requireAnonymous(request);
    const result = await this.auth.login(body.email, body.password, clientIp(request));
    const csrfToken = this.security.issueSession(request, response, result.token);
    return {
      user: result.user,
      session: { expiresAt: result.expiresAt },
      csrfToken,
    };
  }

  @Get('session')
  @Header('Cache-Control', 'no-store')
  @UseGuards(AuthSessionGuard)
  getSession(@CurrentUser() user: AuthPrincipal) {
    return {
      user: { id: user.id, email: user.email },
      session: { expiresAt: user.expiresAt },
    };
  }

  @Post('logout')
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const token = request.cookies?.[this.security.sessionCookieName];
    if (typeof token === 'string' && token) await this.auth.logout(token);
    this.security.clearSessionAndRotate(request, response);
  }

  private async requireAnonymous(request: Request): Promise<void> {
    const token = request.cookies?.[this.security.sessionCookieName];
    if (typeof token !== 'string' || !token) return;
    if (await this.auth.restoreSession(token)) {
      throw new AuthException(HttpStatus.CONFLICT, 'ALREADY_AUTHENTICATED', 'Bạn đã đăng nhập.');
    }
  }
}

function clientIp(request: Request): string {
  return request.ip || request.socket.remoteAddress || 'unknown';
}
