import type { Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { Environment } from '../../../config/environment';
import { Logger } from '@nestjs/common';
import { OutboxService } from './outbox.service';
import { OutboxDispatcher } from './outbox-dispatcher';

describe('Outbox boundary and worker lifecycle', () => {
  const input = {
    organizationId: '5911e94a-4523-46d3-9ac5-ceac16dc405e',
    eventType: 'sales.order_confirmed',
    aggregateId: '9f1f9b98-a73f-4c49-b805-b34cff0fc009',
    payload: { orderNumber: 'SO-2026-000001' },
  };
  it('requires a caller transaction and bounded valid envelopes', async () => {
    const service = new OutboxService();
    await expect(
      service.add({ $connect: jest.fn() } as unknown as Prisma.TransactionClient, input),
    ).rejects.toThrow('caller transaction');
    const create = jest.fn();
    const tx = { outboxEvent: { create } } as unknown as Prisma.TransactionClient;
    for (const invalid of [
      { ...input, eventType: '' },
      { ...input, organizationId: 'foreign' },
      { ...input, aggregateId: 'bad' },
      { ...input, payload: { note: 'x'.repeat(8193) } },
    ])
      await expect(service.add(tx, invalid)).rejects.toMatchObject({ status: 400 });
    expect(create).not.toHaveBeenCalled();
  });
  it('leaves automatic polling off in test apps', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const worker = new OutboxDispatcher({ $queryRaw: query } as unknown as PrismaService, [], {
      NODE_ENV: 'test',
    } as Environment);
    worker.onApplicationBootstrap();
    await worker.onModuleDestroy();
    expect(query).not.toHaveBeenCalled();
  });
  it('rejects duplicate handler registration', () => {
    const handler = { eventType: 'sales.order_confirmed', handle: jest.fn() };
    expect(
      () =>
        new OutboxDispatcher({} as PrismaService, [handler, handler], {
          NODE_ENV: 'test',
        } as Environment),
    ).toThrow('Duplicate outbox handler');
  });
  it('logs a safe polling error without leaking database exception details', async () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    try {
      const worker = new OutboxDispatcher(
        {
          $queryRaw: jest.fn().mockRejectedValue(new Error('synthetic_secret')),
        } as unknown as PrismaService,
        [],
        { NODE_ENV: 'production' } as Environment,
      );
      worker.onApplicationBootstrap();
      await worker.onModuleDestroy();
      expect(log).toHaveBeenCalledWith({ code: 'OUTBOX_POLL_FAILED' });
      expect(JSON.stringify(log.mock.calls)).not.toContain('synthetic_secret');
    } finally {
      log.mockRestore();
    }
  });
  it('starts in production and waits for in-flight work before shutdown', async () => {
    let release!: (value: never[]) => void;
    const pending = new Promise<never[]>((resolve) => {
      release = resolve;
    });
    const query = jest.fn().mockReturnValue(pending);
    const worker = new OutboxDispatcher({ $queryRaw: query } as unknown as PrismaService, [], {
      NODE_ENV: 'production',
    } as Environment);
    worker.onApplicationBootstrap();
    const stopping = worker.onModuleDestroy();
    expect(query).toHaveBeenCalledTimes(1);
    release([]);
    await stopping;
  });
});
