import {
  applyDecorators,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  SetMetadata,
  UseInterceptors,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiHeader } from '@nestjs/swagger';
import type { Response } from 'express';
import { catchError, mergeMap } from 'rxjs';
import { isUUID } from 'class-validator';
import type { AuthorizedRequest } from '../security/security.guard';
import { IdempotentCommand } from './command';
import { IdempotencyService } from './idempotency.service';

const IDEMPOTENT = 'nexus:idempotent';
export const Idempotent = (version = 'v1') =>
  applyDecorators(
    SetMetadata(IDEMPOTENT, version),
    ApiHeader({
      name: 'Idempotency-Key',
      required: true,
      schema: { type: 'string', format: 'uuid' },
    }),
    UseInterceptors(IdempotencyInterceptor),
  );

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly service: IdempotencyService,
    private readonly reflector: Reflector,
  ) {}
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<AuthorizedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    if (!request.actor) throw new ForbiddenException();
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || !isUUID(key))
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'Cần Idempotency-Key là UUID hợp lệ',
      });
    const params = Object.fromEntries(
      Object.entries(request.params)
        .map(
          ([name, value]) =>
            [
              name,
              typeof value === 'string' && isUUID(value) ? value.toLowerCase() : value,
            ] as const,
        )
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
    const command = JSON.stringify([request.method, request.route.path, params]);
    if (command.length > 512) throw new InternalServerErrorException();
    return next.handle().pipe(
      mergeMap(async (plan: unknown) => {
        if (!(plan instanceof IdempotentCommand)) throw new InternalServerErrorException();
        const result = await this.service.execute(
          {
            organizationId: request.actor.organizationId,
            actorId: request.actor.id,
            key: key.toLowerCase(),
            command,
            version: this.reflector.get<string>(IDEMPOTENT, context.getHandler()),
          },
          plan,
          response.statusCode,
        );
        response.status(result.status).setHeader('Idempotency-Replayed', String(result.replayed));
        return result.data;
      }),
      catchError((error: unknown) => {
        if (
          error instanceof ConflictException &&
          (error.getResponse() as { code?: string }).code === 'REQUEST_IN_PROGRESS'
        )
          response.setHeader('Retry-After', '1');
        throw error;
      }),
    );
  }
}
