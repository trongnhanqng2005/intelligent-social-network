import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  ValidationPipe,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AuthException } from './auth.errors.js';
import { AuthSecurityService } from './auth-security.service.js';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

export function configureAuthHttp(app: NestExpressApplication, security: AuthSecurityService, trustedOrigin: string) {
  app.use(cookieParser());
  app.use(helmet({
    strictTransportSecurity: security.production ? undefined : false,
  }));
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (request.path === '/users' || request.path.startsWith('/users/')) {
      response.setHeader('Cache-Control', 'no-store');
    }
    next();
  });
  app.useBodyParser('json', { limit: '8kb', strict: true });
  app.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
    if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.parse.failed') {
      response.status(HttpStatus.BAD_REQUEST).json({
        error: { code: 'BAD_REQUEST', message: 'Yêu cầu không hợp lệ.' },
      });
      return;
    }
    if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large') {
      response.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
        error: { code: 'PAYLOAD_TOO_LARGE', message: 'Nội dung yêu cầu vượt quá giới hạn cho phép.' },
      });
      return;
    }
    next(error);
  });
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (safeMethods.has(request.method)) return next();
    if (request.get('Sec-Fetch-Site') === 'cross-site') {
      return sendCsrfFailure(response);
    }
    const source = request.get('Origin') ?? refererOrigin(request.get('Referer'));
    if (!source || source !== trustedOrigin) return sendCsrfFailure(response);
    if (request.path === '/users/me/profile' && request.method === 'PATCH' &&
        !request.is('application/json')) {
      response.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE).json({
        error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Chỉ chấp nhận dữ liệu JSON.' },
      });
      return;
    }
    if ((request.path === '/auth/register' || request.path === '/auth/login') &&
        !request.is('application/json')) {
      response.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE).json({
        error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Chỉ chấp nhận dữ liệu JSON.' },
      });
      return;
    }
    next();
  });
  app.use((request: Request, response: Response, next: NextFunction) => {
    security.middleware()(request, response, (error?: unknown) => {
      if (error) return sendCsrfFailure(response);
      next();
    });
  });
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    exceptionFactory: (errors) => {
      const fieldErrors: Record<string, string[]> = {};
      for (const error of errors) {
        if (['email', 'password', 'displayName', 'bio', 'location', 'expectedVersion', 'id', 'q', 'limit', 'cursor'].includes(error.property)) {
          fieldErrors[error.property] = Object.values(error.constraints ?? {});
        }
      }
      return new AuthException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_ERROR',
        'Dữ liệu không hợp lệ.',
        Object.keys(fieldErrors).length ? fieldErrors : undefined,
      );
    },
  }));
  app.useGlobalFilters(new AuthHttpExceptionFilter());
}

@Catch()
class AuthHttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : statusFromError(exception);
    if (exception instanceof HttpException && 'retryAfterSeconds' in exception &&
        typeof exception.retryAfterSeconds === 'number' && exception.retryAfterSeconds > 0) {
      response.setHeader('Retry-After', String(exception.retryAfterSeconds));
    }
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null && 'error' in body) {
        response.status(status).json(body);
        return;
      }
    }
    const error = status === HttpStatus.UNAUTHORIZED
      ? { code: 'UNAUTHENTICATED', message: 'Vui lòng đăng nhập để tiếp tục.' }
      : status === HttpStatus.FORBIDDEN
        ? { code: 'CSRF_FAILED', message: 'Yêu cầu không hợp lệ. Vui lòng tải lại trang rồi thử lại.' }
        : status === HttpStatus.TOO_MANY_REQUESTS
          ? { code: 'RATE_LIMITED', message: 'Bạn đã thử quá nhiều lần. Vui lòng chờ rồi thử lại.' }
          : status === HttpStatus.SERVICE_UNAVAILABLE
            ? { code: 'SERVICE_UNAVAILABLE', message: 'Dịch vụ tạm thời không khả dụng. Vui lòng thử lại.' }
            : status === HttpStatus.BAD_REQUEST
              ? { code: 'BAD_REQUEST', message: 'Yêu cầu không hợp lệ.' }
              : { code: 'INTERNAL_ERROR', message: 'Đã xảy ra lỗi. Vui lòng thử lại.' };
    response.status(status).json({ error });
  }
}

function sendCsrfFailure(response: Response): void {
  response.status(HttpStatus.FORBIDDEN).json({
    error: { code: 'CSRF_FAILED', message: 'Yêu cầu không hợp lệ. Vui lòng tải lại trang rồi thử lại.' },
  });
}

function refererOrigin(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function statusFromError(error: unknown): number {
  if (typeof error === 'object' && error !== null) {
    if ('status' in error && typeof error.status === 'number') return error.status === 400 ? 400 : 500;
    if ('code' in error && typeof error.code === 'string' && error.code.startsWith('Neo.')) {
      return HttpStatus.SERVICE_UNAVAILABLE;
    }
  }
  return HttpStatus.INTERNAL_SERVER_ERROR;
}
