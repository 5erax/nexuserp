import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { OutboxHandler, OutboxMessage } from './handler';

@Injectable()
export class ReceiptConsumer implements OutboxHandler {
  readonly eventType = 'sales.order_confirmed';
  constructor(private readonly prisma: PrismaService) {}
  async handle(message: OutboxMessage) {
    await this.prisma.outboxReceipt.createMany({
      data: [
        {
          eventId: message.id,
          organizationId: message.organizationId,
          eventType: message.eventType,
          aggregateId: message.aggregateId,
        },
      ],
      skipDuplicates: true,
    });
  }
}
