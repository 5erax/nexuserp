import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { ENVIRONMENT, parseEnvironment, type Environment } from '../src/config/environment';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { OutboxService } from '../src/modules/outbox/application/outbox.service';
import { OutboxDispatcher } from '../src/modules/outbox/application/outbox-dispatcher';
import { ReceiptConsumer } from '../src/modules/outbox/application/receipt-consumer';

describe('Transactional outbox, leases and idempotent durable consumer', () => {
  let app: INestApplication,
    prisma: PrismaService,
    service: OutboxService,
    worker: OutboxDispatcher,
    receipt: ReceiptConsumer,
    config: Environment;
  let root: Client,
    organizationId: string,
    created = false;
  const databaseName = 'nexus_outbox_' + randomUUID().replaceAll('-', '') + '_test';
  let log: jest.SpyInstance;
  const add = (eventType = 'sales.order_confirmed') =>
    prisma.$transaction((tx) =>
      service.add(tx, {
        organizationId,
        eventType,
        aggregateId: randomUUID(),
        payload: { orderNumber: 'SO-2026-000001' },
      }),
    );
  const due = (id: string) =>
    prisma.$executeRaw`UPDATE outbox_events SET available_at = clock_timestamp() - interval '1 second' WHERE id = ${id}::uuid`;
  beforeAll(async () => {
    const target = process.env.TEST_DATABASE_URL;
    if (
      !target ||
      !new URL(target).pathname.endsWith('_test') ||
      !/^nexus_outbox_[a-f0-9]{32}_test$/.test(databaseName)
    )
      throw new Error('Explicit _test database and owned UUID database required');
    root = new Client({ connectionString: target });
    await root.connect();
    await root.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    const url = new URL(target);
    url.pathname = '/' + databaseName;
    const connection = new Client({ connectionString: url.toString() });
    await connection.connect();
    try {
      const migrations = join(__dirname, '../prisma/migrations');
      for (const entry of readdirSync(migrations, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name)))
        await connection.query(readFileSync(join(migrations, entry.name, 'migration.sql'), 'utf8'));
    } finally {
      await connection.end();
    }
    config = parseEnvironment({ ...process.env, DATABASE_URL: url.toString(), NODE_ENV: 'test' });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENVIRONMENT)
      .useValue(config)
      .compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    const [database] = await prisma.$queryRaw<
      { name: string }[]
    >`SELECT current_database() AS name`;
    if (database?.name !== databaseName)
      throw new Error('Worker tests must use their owned database');
    organizationId = (
      await prisma.organization.create({ data: { code: 'OUTBOX', name: 'Outbox fixture' } })
    ).id;
    service = app.get(OutboxService);
    worker = app.get(OutboxDispatcher);
    receipt = app.get(ReceiptConsumer);
  }, 30000);
  afterAll(async () => {
    if (app) await app.close();
    if (root) {
      try {
        if (created && /^nexus_outbox_[a-f0-9]{32}_test$/.test(databaseName))
          await root.query(`DROP DATABASE "${databaseName}"`);
      } finally {
        await root.end();
      }
    }
  });
  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    log?.mockRestore();
  });
  it('exposes events only after business commit and removes them on rollback', async () => {
    let committed = '';
    await prisma.$transaction(async (tx) => {
      committed = await service.add(tx, {
        organizationId,
        eventType: 'sales.order_confirmed',
        aggregateId: randomUUID(),
        payload: { orderNumber: 'SO-2026-000001' },
      });
      expect(await prisma.outboxEvent.findUnique({ where: { id: committed } })).toBeNull();
      expect(await worker.dispatchOnce()).toBe(0);
    });
    await worker.dispatchOnce();
    expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: committed } })).toMatchObject({
      status: 'PUBLISHED',
      attempts: 1,
      lockToken: null,
      lockedUntil: null,
    });
    expect(await prisma.outboxReceipt.count({ where: { eventId: committed } })).toBe(1);
    const before = await prisma.outboxEvent.count();
    await expect(
      prisma.$transaction(async (tx) => {
        await service.add(tx, {
          organizationId,
          eventType: 'sales.order_confirmed',
          aggregateId: randomUUID(),
          payload: {},
        });
        throw new Error('synthetic business rollback');
      }),
    ).rejects.toThrow('synthetic business rollback');
    expect(await prisma.outboxEvent.count()).toBe(before);
  });
  it('bounds each claim to 10 and lets two dispatchers process disjoint events', async () => {
    const ids: string[] = [];
    for (let index = 0; index < 25; index++) ids.push(await add());
    const other = new OutboxDispatcher(prisma, [receipt], config);
    let release!: () => void,
      entered!: () => void,
      count = 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const both = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const handle = receipt.handle.bind(receipt);
    const spy = jest.spyOn(receipt, 'handle').mockImplementation(async (message) => {
      count++;
      if (count === 2) entered();
      await gate;
      await handle(message);
    });
    const a = worker.dispatchOnce(),
      b = other.dispatchOnce();
    try {
      await Promise.race([
        both,
        Promise.all([a, b]).then(() => {
          throw new Error('Claims did not reach handlers');
        }),
      ]);
      expect(
        await prisma.outboxEvent.count({ where: { id: { in: ids }, status: 'PROCESSING' } }),
      ).toBe(20);
      expect(
        await prisma.outboxEvent.count({ where: { id: { in: ids }, status: 'PENDING' } }),
      ).toBe(5);
      release();
      await Promise.all([a, b]);
      await worker.dispatchOnce();
      expect(new Set(spy.mock.calls.map(([message]) => message.id)).size).toBe(25);
      expect(spy).toHaveBeenCalledTimes(25);
      expect(await prisma.outboxReceipt.count({ where: { eventId: { in: ids } } })).toBe(25);
      expect(
        await prisma.outboxEvent.count({
          where: { id: { in: ids }, status: 'PUBLISHED', attempts: 1 },
        }),
      ).toBe(25);
    } finally {
      release();
      await Promise.allSettled([a, b]);
      spy.mockRestore();
    }
  });
  it('backs off failures, respects due times and retries without logging exception details', async () => {
    const id = await add();
    const handler = jest
      .spyOn(receipt, 'handle')
      .mockRejectedValueOnce(new Error('synthetic_private_exception'));
    try {
      await worker.dispatchOnce();
      const failed = await prisma.outboxEvent.findUniqueOrThrow({ where: { id } });
      expect(failed).toMatchObject({
        status: 'PENDING',
        attempts: 1,
        lastError: 'OUTBOX_HANDLER_FAILED',
        lockToken: null,
      });
      expect(failed.availableAt.getTime() - failed.createdAt.getTime()).toBeGreaterThanOrEqual(
        1000,
      );
      expect(JSON.stringify(log.mock.calls)).not.toContain('synthetic_private_exception');
      await prisma.$executeRaw`UPDATE outbox_events SET available_at = clock_timestamp() + interval '1 hour' WHERE id = ${id}::uuid`;
      expect(await worker.dispatchOnce()).toBe(0);
      await due(id);
      await worker.dispatchOnce();
      expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id } })).toMatchObject({
        status: 'PUBLISHED',
        attempts: 2,
        lastError: null,
      });
      expect(await prisma.outboxReceipt.count({ where: { eventId: id } })).toBe(1);
    } finally {
      handler.mockRestore();
    }
  });
  it('dead-letters unregistered handlers after five attempts', async () => {
    const id = await add('proof.unregistered');
    for (let attempt = 1; attempt <= 5; attempt++) {
      await due(id);
      await worker.dispatchOnce();
      expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id } })).toMatchObject({
        attempts: attempt,
        status: attempt === 5 ? 'DEAD' : 'PENDING',
        lastError: 'OUTBOX_HANDLER_NOT_REGISTERED',
      });
    }
    expect(await worker.dispatchOnce()).toBe(0);
    expect(await prisma.outboxReceipt.count({ where: { eventId: id } })).toBe(0);
  });
  it('recovers a crash after the durable effect but before acknowledgement exactly once', async () => {
    const id = await add();
    const message = await prisma.outboxEvent.update({
      where: { id },
      data: {
        status: 'PROCESSING',
        attempts: 1,
        lockToken: randomUUID(),
        lockedUntil: new Date('2099-01-01'),
      },
    });
    await receipt.handle(message);
    const original = await prisma.outboxReceipt.findUniqueOrThrow({ where: { eventId: id } });
    await prisma.outboxEvent.update({ where: { id }, data: { lockedUntil: new Date(0) } });
    await new OutboxDispatcher(prisma, [receipt], config).dispatchOnce();
    expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: 'PUBLISHED',
      attempts: 2,
    });
    expect(await prisma.outboxReceipt.findUniqueOrThrow({ where: { eventId: id } })).toEqual(
      original,
    );
  });
  it('dead-letters an expired final lease rather than leaving PROCESSING forever', async () => {
    const id = await add();
    await prisma.outboxEvent.update({
      where: { id },
      data: {
        status: 'PROCESSING',
        attempts: 5,
        lockToken: randomUUID(),
        lockedUntil: new Date(0),
      },
    });
    await worker.dispatchOnce();
    expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: 'DEAD',
      attempts: 5,
      lockedUntil: null,
      lockToken: null,
      lastError: 'OUTBOX_ATTEMPTS_EXHAUSTED',
    });
    expect(await prisma.outboxReceipt.count({ where: { eventId: id } })).toBe(0);
  });
  it('does not let a stale worker overwrite a newer lease acknowledgement', async () => {
    const id = await add();
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const handle = receipt.handle.bind(receipt);
    const spy = jest.spyOn(receipt, 'handle').mockImplementationOnce(async (message) => {
      await handle(message);
      entered();
      await gate;
      throw new Error('stale_private_error');
    });
    const first = worker.dispatchOnce();
    try {
      await Promise.race([
        started,
        first.then(() => {
          throw new Error('First lease was not processed');
        }),
      ]);
      await prisma.outboxEvent.update({ where: { id }, data: { lockedUntil: new Date(0) } });
      await new OutboxDispatcher(prisma, [receipt], config).dispatchOnce();
      const acknowledged = await prisma.outboxEvent.findUniqueOrThrow({ where: { id } });
      release();
      await first;
      expect(acknowledged).toMatchObject({ status: 'PUBLISHED', attempts: 2 });
      expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id } })).toEqual(acknowledged);
      expect(await prisma.outboxReceipt.count({ where: { eventId: id } })).toBe(1);
      expect(JSON.stringify(log.mock.calls)).not.toContain('stale_private_error');
    } finally {
      release();
      await Promise.allSettled([first]);
      spy.mockRestore();
    }
  });
  it('keeps receipts immutable and prevents cross-organization receipt references', async () => {
    const id = await add();
    const other = await prisma.organization.create({
      data: { code: 'FOREIGN', name: 'Foreign receipt fixture' },
    });
    await expect(
      prisma.outboxReceipt.create({
        data: {
          eventId: id,
          organizationId: other.id,
          eventType: 'sales.order_confirmed',
          aggregateId: randomUUID(),
        },
      }),
    ).rejects.toThrow();
    await worker.dispatchOnce();
    await expect(
      prisma.outboxReceipt.update({ where: { eventId: id }, data: { eventType: 'changed' } }),
    ).rejects.toThrow();
    await expect(prisma.outboxReceipt.delete({ where: { eventId: id } })).rejects.toThrow();
    await expect(prisma.outboxEvent.delete({ where: { id } })).rejects.toThrow();
  });
});
