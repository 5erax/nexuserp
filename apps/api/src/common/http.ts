import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { map } from 'rxjs';
export type CorrelatedRequest = Request & { requestId: string };
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<CorrelatedRequest>();
    return next
      .handle()
      .pipe(map((data: unknown) => ({ data, meta: { requestId: request.requestId } })));
  }
}
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<CorrelatedRequest>();
    const response = http.getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const payload = exception instanceof HttpException ? exception.getResponse() : undefined;
    const structured =
      typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
    const codes: Record<number, string> = {
      400: 'VALIDATION_ERROR',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'BUSINESS_RULE_VIOLATION',
      429: 'RATE_LIMITED',
      503: 'SERVICE_UNAVAILABLE',
    };
    const code =
      status === 500
        ? 'INTERNAL_ERROR'
        : typeof structured.code === 'string'
          ? structured.code
          : (codes[status] ?? 'HTTP_ERROR');
    const message =
      status >= 500
        ? 'Dịch vụ tạm thời không khả dụng'
        : typeof structured.message === 'string'
          ? structured.message
          : 'Request không hợp lệ';
    if (status === 500)
      new Logger('HTTP').error({
        event: 'unhandled_error',
        requestId: request.requestId,
        exceptionType: exception instanceof Error ? exception.constructor.name : 'Unknown',
        // Exception messages can contain credentials or SQL parameters; retain only call sites.
        stack:
          exception instanceof Error
            ? exception.stack
                ?.split('\n')
                .filter((line) => /^\s+at /.test(line))
                .join('\n')
            : undefined,
      });
    response.status(status).json({
      error: {
        code,
        message,
        details: status < 500 ? (structured.details ?? null) : null,
        requestId: request.requestId,
      },
    });
  }
}
