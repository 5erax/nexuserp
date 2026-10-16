import { Prisma } from '../src/generated/prisma/client';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { withTransactionRetry } from '../src/infrastructure/prisma/transaction';

describe('Transaction retry boundary', () => {
  it('retries a Prisma ORM conflict but preserves read-committed isolation', async () => {
    const transaction = jest
      .fn()
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('synthetic conflict', {
          code: 'P2034',
          clientVersion: Prisma.prismaVersion.client,
        }),
      )
      .mockResolvedValue('committed');
    await expect(
      withTransactionRetry(
        { $transaction: transaction } as unknown as PrismaService,
        async () => 'result',
      ),
    ).resolves.toBe('committed');
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(transaction).toHaveBeenLastCalledWith(expect.any(Function), {
      isolationLevel: 'ReadCommitted',
    });
  });
  it('does not retry uncertain timeouts, connection failures or unrelated raw SQL errors', async () => {
    for (const error of [
      new Error('connection lost'),
      new Prisma.PrismaClientKnownRequestError('timeout', {
        code: 'P2028',
        clientVersion: Prisma.prismaVersion.client,
      }),
      new Prisma.PrismaClientKnownRequestError('invalid SQL', {
        code: 'P2010',
        clientVersion: Prisma.prismaVersion.client,
        meta: { driverAdapterError: new Error('syntax', { cause: { kind: 'SyntaxError' } }) },
      }),
    ]) {
      const transaction = jest.fn().mockRejectedValue(error);
      await expect(
        withTransactionRetry(
          { $transaction: transaction } as unknown as PrismaService,
          async () => {},
        ),
      ).rejects.toBe(error);
      expect(transaction).toHaveBeenCalledTimes(1);
    }
  });
});
