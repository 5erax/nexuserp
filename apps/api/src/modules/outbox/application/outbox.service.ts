import { BadRequestException, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Prisma } from '../../../generated/prisma/client';

@Injectable()
export class OutboxService {
  async add(
    tx: Prisma.TransactionClient,
    input: {
      organizationId: string;
      eventType: string;
      aggregateId: string;
      payload: Prisma.InputJsonObject;
    },
  ) {
    if (typeof Reflect.get(tx, '$connect') === 'function')
      throw new Error('Outbox events require a caller transaction');
    if (
      !isUUID(input.organizationId) ||
      !isUUID(input.aggregateId) ||
      typeof input.eventType !== 'string' ||
      !/^[a-z][a-z0-9_.]{0,99}$/.test(input.eventType) ||
      typeof input.payload !== 'object' ||
      input.payload === null ||
      Array.isArray(input.payload) ||
      Buffer.byteLength(JSON.stringify(input.payload)) > 8192
    )
      throw new BadRequestException({
        code: 'INVALID_OUTBOX_EVENT',
        message: 'Sự kiện không hợp lệ hoặc payload vượt 8 KiB',
      });
    return (await tx.outboxEvent.create({ data: input, select: { id: true } })).id;
  }
}
