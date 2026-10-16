import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { withTransactionRetry } from '../src/infrastructure/prisma/transaction';
import { parseEnvironment } from '../src/config/environment';
import { StockLedgerService } from '../src/modules/inventory/application/stock-ledger.service';
import { ReservationsService } from '../src/modules/inventory/application/reservations.service';
import { ReconciliationService } from '../src/modules/inventory/application/reconciliation.service';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service';
import { IdempotentCommand } from '../src/common/idempotency/command';
import { PasswordService } from '../src/modules/iam/application/password.service';
import { cleanupInventory } from './fixtures/cleanup-inventory';
import { cleanupIam } from './fixtures/cleanup-iam';
import { reservationFixtures } from './fixtures/reservation-order';

describe('INV-002/003/004/009 PostgreSQL contention, 20 rounds', () => {
  let prisma: PrismaService, reconciliation: ReconciliationService;
  const ledger = new StockLedgerService(),
    reservations = new ReservationsService(ledger);
  const org = randomUUID(),
    branch = randomUUID(),
    warehouse = randomUUID(),
    actor = randomUUID(),
    product = randomUUID();
  beforeAll(async () => {
    if (
      !process.env.TEST_DATABASE_URL ||
      !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')
    )
      throw new Error('Explicit _test database required');
    prisma = new PrismaService(
      parseEnvironment({ ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL }),
    );
    reconciliation = new ReconciliationService(prisma);
    await prisma.organization.create({
      data: { id: org, code: 'CC-' + org.slice(0, 8), name: 'Contention fixture' },
    });
    await prisma.branch.create({
      data: { id: branch, organizationId: org, code: 'MAIN', name: 'Main' },
    });
    await prisma.warehouse.create({
      data: { id: warehouse, organizationId: org, branchId: branch, code: 'MAIN', name: 'Main' },
    });
    await prisma.user.create({
      data: {
        id: actor,
        organizationId: org,
        email: 'contention@example.test',
        displayName: 'Fixture',
        passwordHash: await new PasswordService().hash('synthetic-contention-password'),
      },
    });
    await prisma.product.create({
      data: { id: product, organizationId: org, name: 'Contention product' },
    });
  });
  afterAll(async () => {
    if (!prisma) return;
    await cleanupInventory(prisma, [org]);
    await cleanupIam(prisma, [org]);
    await prisma.$disconnect();
  });
  const variant = async () =>
    (
      await prisma.productVariant.create({
        data: {
          organizationId: org,
          productId: product,
          sku: randomUUID().toUpperCase(),
          name: 'Contention variant',
          sellingPrice: '1',
        },
      })
    ).id;
  const selection = (referenceId: string = randomUUID()) => ({
    organizationId: org,
    warehouseId: warehouse,
    referenceId,
  });
  const stock = async (variantId: string) =>
    prisma.$transaction((tx) =>
      ledger.post(tx, {
        organizationId: org,
        warehouseId: warehouse,
        variantId,
        createdBy: actor,
        referenceId: randomUUID(),
        referenceType: 'OPENING',
        quantityDelta: '10',
      }),
    );
  const balance = (variantId: string) =>
    prisma.stockBalance.findUniqueOrThrow({
      where: {
        organizationId_warehouseId_variantId: {
          organizationId: org,
          warehouseId: warehouse,
          variantId,
        },
      },
    });
  const clean = async () => {
    const result = await reconciliation.check(org, { page: 1, pageSize: 100 });
    expect(result.items).toEqual([]);
    expect(result.meta).toMatchObject({ total: 0 });
  };
  const code = (reason: unknown) =>
    reason instanceof ConflictException
      ? (reason.getResponse() as { code: string }).code
      : (reason as { code?: string })?.code;

  for (let round = 1; round <= 20; round++) {
    it(`round ${round}: 100 contenders`, async () => {
      const id = await variant();
      await stock(id);
      const inputs = await reservationFixtures(
        prisma,
        Array.from({ length: 100 }, () => ({
          ...selection(),
          items: [{ variantId: id, quantity: '1' }],
        })),
      );
      const results = await Promise.allSettled(
        inputs.map((input) =>
          withTransactionRetry(prisma, (tx) => reservations.reserve(tx, input)),
        ),
      );
      const successful = results
        .filter((result) => result.status === 'fulfilled')
        .map((result) => result.value[0]!);
      const failed = results.filter((result) => result.status === 'rejected');
      expect(successful).toHaveLength(10);
      expect(failed).toHaveLength(90);
      expect(new Set(failed.map((result) => code(result.reason)))).toEqual(
        new Set(['INSUFFICIENT_STOCK']),
      );
      const held = await balance(id);
      expect(held.onHand.toFixed(3)).toBe('10.000');
      expect(held.reserved.toFixed(3)).toBe('10.000');
      expect(
        await prisma.stockReservation.count({
          where: { organizationId: org, balanceId: held.id, status: 'ACTIVE' },
        }),
      ).toBe(10);
      await clean();
      const terminal = await Promise.allSettled(
        successful.map((row, index) =>
          withTransactionRetry(prisma, (tx) =>
            index % 2
              ? reservations.release(tx, selection(row.referenceId))
              : reservations.consume(tx, {
                  ...selection(row.referenceId),
                  createdBy: actor,
                  shipmentId: randomUUID(),
                }),
          ),
        ),
      );
      expect(terminal.filter((result) => result.status === 'rejected')).toEqual([]);
      const ended = await balance(id);
      expect(ended.onHand.toFixed(3)).toBe('5.000');
      expect(ended.reserved.isZero()).toBe(true);
      expect(
        await prisma.stockMovement.count({ where: { organizationId: org, variantId: id } }),
      ).toBe(6);
      await clean();
    }, 30000);
    it(`round ${round}: reversed multi-SKU commands`, async () => {
      const ids = [await variant(), await variant()];
      for (const id of ids) await stock(id);
      const references = Array.from({ length: 10 }, () => randomUUID());
      const inputs = await reservationFixtures(
        prisma,
        references.map((referenceId, index) => ({
          ...selection(referenceId),
          items: (index % 2 ? [...ids].reverse() : ids).map((variantId) => ({
            variantId,
            quantity: '1',
          })),
        })),
      );
      const held = await Promise.allSettled(
        inputs.map((input) =>
          withTransactionRetry(prisma, (tx) => reservations.reserve(tx, input)),
        ),
      );
      expect(held.filter((result) => result.status === 'rejected')).toEqual([]);
      for (const id of ids) expect((await balance(id)).reserved.toFixed(3)).toBe('10.000');
      await clean();
      const consumed = await Promise.allSettled(
        references.map((referenceId) =>
          withTransactionRetry(prisma, (tx) =>
            reservations.consume(tx, {
              ...selection(referenceId),
              createdBy: actor,
              shipmentId: randomUUID(),
            }),
          ),
        ),
      );
      expect(consumed.filter((result) => result.status === 'rejected')).toEqual([]);
      for (const id of ids) {
        const row = await balance(id);
        expect(row.onHand.isZero() && row.reserved.isZero()).toBe(true);
      }
      await clean();
    }, 30000);
    it(`round ${round}: 100 retries of one idempotent movement`, async () => {
      const id = await variant(),
        service = new IdempotencyService(prisma);
      const identity = {
        organizationId: org,
        actorId: actor,
        command: 'POST /concurrency/opening',
        key: randomUUID(),
        version: 'v1',
      };
      const input = {
        organizationId: org,
        warehouseId: warehouse,
        variantId: id,
        createdBy: actor,
        referenceId: randomUUID(),
        referenceType: 'OPENING' as const,
        quantityDelta: '1',
      };
      const command = new IdempotentCommand(
        input,
        async () => {},
        async (tx) => ({ id: (await ledger.post(tx, input)).id }),
      );
      const results = await Promise.allSettled(
        Array.from({ length: 100 }, () => service.execute(identity, command, 201)),
      );
      const successful = results.filter((result) => result.status === 'fulfilled');
      expect(successful.length).toBeGreaterThan(0);
      expect(new Set(successful.map((result) => result.value.data.id)).size).toBe(1);
      for (const result of results)
        if (result.status === 'rejected') expect(code(result.reason)).toBe('REQUEST_IN_PROGRESS');
      expect((await service.execute(identity, command, 201)).replayed).toBe(true);
      expect((await balance(id)).onHand.toFixed(3)).toBe('1.000');
      expect(
        await prisma.stockMovement.count({ where: { organizationId: org, variantId: id } }),
      ).toBe(1);
      expect(
        await prisma.idempotencyKey.count({ where: { organizationId: org, key: identity.key } }),
      ).toBe(1);
      await clean();
    }, 30000);
  }
});
