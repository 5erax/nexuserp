import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  HttpException,
  INestApplication,
  Logger,
  ValidationPipe,
} from '@nestjs/common';
import helmet from 'helmet';
import type { Response, NextFunction } from 'express';
import { json } from 'express';
import { ApiExceptionFilter, CorrelatedRequest, EnvelopeInterceptor } from './common/http';
import { ENVIRONMENT, type Environment } from './config/environment';
import { RateLimiter } from './common/security/rate-limiter';
import { clientAddress } from './common/security/client-address';
export function configureApp(app: INestApplication, development = false) {
  const config = app.get<Environment>(ENVIRONMENT);
  const limiter = app.get(RateLimiter);
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  if (development)
    app.use('/api/docs', (_request: CorrelatedRequest, response: Response, next: NextFunction) => {
      // Swagger initializes inline; keep the default CSP on every other route.
      response.removeHeader('Content-Security-Policy');
      next();
    });
  app.use((request: CorrelatedRequest, response: Response, next: NextFunction) => {
    const header = request.headers['x-request-id'];
    request.requestId =
      typeof header === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(header) ? header : randomUUID();
    response.setHeader('X-Request-Id', request.requestId);
    const start = performance.now();
    response.on('finish', () =>
      new Logger('HTTP').log({
        event: 'request_completed',
        requestId: request.requestId,
        method: request.method,
        status: response.statusCode,
        durationMs: Math.round(performance.now() - start),
      }),
    );
    next();
  });
  app.use((request: CorrelatedRequest, response: Response, next: NextFunction) => {
    response.setHeader('Cache-Control', 'no-store');
    try {
      request.clientIp = clientAddress(request, config.TRUSTED_PROXY_IP);
      limiter.take('api:' + request.clientIp, config.API_RATE_LIMIT, 60000, response);
      next();
    } catch (error) {
      next(error);
    }
  });
  app.use(json({ limit: '1mb' }));
  app.use(
    (error: unknown, _request: CorrelatedRequest, _response: Response, next: NextFunction) => {
      const type =
        typeof error === 'object' && error !== null && 'type' in error ? error.type : undefined;
      if (type === 'entity.parse.failed' || type === 'entity.too.large') {
        next(
          new HttpException(
            {
              code: type === 'entity.too.large' ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_ERROR',
              message: 'Nội dung yêu cầu không hợp lệ',
            },
            type === 'entity.too.large' ? 413 : 400,
          ),
        );
      } else next(error);
    },
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      validationError: { target: false, value: false },
      exceptionFactory: (errors) =>
        new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Request không hợp lệ',
          details: errors.map((error) => ({
            field: error.property,
            messages: Object.values(error.constraints ?? {}),
          })),
        }),
    }),
  );
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
}
