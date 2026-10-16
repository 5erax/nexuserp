import { setTimeout } from 'node:timers/promises';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { PrismaService } from './prisma.service';

export async function withTransactionRetry<T>(
  prisma: PrismaService,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(run, {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      });
    } catch (error) {
      const known = error instanceof Prisma.PrismaClientKnownRequestError;
      const adapter = known ? error.meta?.driverAdapterError : undefined;
      const cause = adapter instanceof Error ? adapter.cause : undefined;
      const rawConflict =
        typeof cause === 'object' &&
        cause !== null &&
        'kind' in cause &&
        cause.kind === 'TransactionWriteConflict';
      const retryable =
        known && (error.code === 'P2034' || (error.code === 'P2010' && rawConflict));
      if (!retryable) throw error;
      if (attempt === 2)
        throw new ConflictException({
          code: 'TRANSACTION_CONFLICT',
          message: 'Dữ liệu đang được xử lý đồng thời, hãy thử lại',
        });
      await setTimeout(10 * (attempt + 1));
    }
  }
}
