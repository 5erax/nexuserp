import { randomUUID } from 'node:crypto';
import { BadRequestException, INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import type { Response, NextFunction } from 'express';
import { ApiExceptionFilter, CorrelatedRequest, EnvelopeInterceptor } from './common/http';
export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
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
