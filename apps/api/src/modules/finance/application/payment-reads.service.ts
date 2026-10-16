import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';

@Injectable()
export class PaymentReadsService {
  async hasForOrder(tx: Prisma.TransactionClient, organizationId: string, salesOrderId: string) {
    if (typeof Reflect.get(tx, '$connect') === 'function')
      throw new Error('Payment reads require a caller transaction');
    return Boolean(
      await tx.payment.findFirst({ where: { organizationId, salesOrderId }, select: { id: true } }),
    );
  }
}
