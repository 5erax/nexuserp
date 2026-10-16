import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { withTransactionRetry } from '../src/infrastructure/prisma/transaction';
import { parseEnvironment } from '../src/config/environment';
import { StockLedgerService } from '../src/modules/inventory/application/stock-ledger.service';
import { ReservationsService } from '../src/modules/inventory/application/reservations.service';
import { PasswordService } from '../src/modules/iam/application/password.service';
import { cleanupInventory } from './fixtures/cleanup-inventory';
import { cleanupIam } from './fixtures/cleanup-iam';
import { reservationFixture, type ReservationDraft } from './fixtures/reservation-order';

describe('INV-002/003/009 Atomic reservations on PostgreSQL', () => {
  let prisma: PrismaService;
  const ledger = new StockLedgerService(),
    service = new ReservationsService(ledger);
  const org = randomUUID(),
    other = randomUUID(),
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
    await prisma.organization.createMany({
      data: [org, other].map((id) => ({
        id,
        code: 'R-' + id.slice(0, 8),
        name: 'Reservation fixture',
      })),
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
        email: 'reservation@example.test',
        displayName: 'Fixture',
        passwordHash: await new PasswordService().hash('synthetic-reservation-password'),
      },
    });
    await prisma.product.create({
      data: { id: product, organizationId: org, name: 'Reservation product' },
    });
  });
  afterAll(async () => {
    if (!prisma) return;
    await cleanupInventory(prisma, [org, other]);
    await cleanupIam(prisma, [org, other]);
    await prisma.$disconnect();
  });
  const selection = () => ({
    organizationId: org,
    warehouseId: warehouse,
    referenceId: randomUUID(),
  });
  const stock = async (...quantities: string[]) => {
    const ids: string[] = [];
    for (const quantityDelta of quantities) {
      const row = await prisma.productVariant.create({
        data: {
          organizationId: org,
          productId: product,
          sku: randomUUID().toUpperCase(),
          name: 'Variant',
          sellingPrice: '1',
        },
      });
      ids.push(row.id);
      await prisma.$transaction((tx) =>
        ledger.post(tx, {
          organizationId: org,
          warehouseId: warehouse,
          variantId: row.id,
          createdBy: actor,
          referenceId: randomUUID(),
          referenceType: 'OPENING',
          quantityDelta,
        }),
      );
    }
    return ids;
  };
  const balances = (ids: string[]) =>
    prisma.stockBalance.findMany({
      where: { organizationId: org, variantId: { in: ids } },
      orderBy: { variantId: 'asc' },
    });
  const reserve = async (input: ReservationDraft) => {
    const linked = await reservationFixture(prisma, input);
    return withTransactionRetry(prisma, (tx) => service.reserve(tx, linked));
  };
  const release = (input: Parameters<ReservationsService['release']>[1]) =>
    withTransactionRetry(prisma, (tx) => service.release(tx, input));
  const consume = (input: Parameters<ReservationsService['consume']>[1]) =>
    withTransactionRetry(prisma, (tx) => service.consume(tx, input));

  it('reserves exact quantities then releases without changing on-hand or movement history', async () => {
    const ids = await stock('10.125', '5'),
      command = selection();
    const items = ids.map((variantId) => ({ variantId, quantity: '1.125' }));
    await reserve({ ...command, items });
    expect((await balances(ids)).every((r) => r.reserved.toFixed(3) === '1.125')).toBe(true);
    await release(command);
    expect((await balances(ids)).every((r) => r.reserved.isZero())).toBe(true);
    expect(
      await prisma.stockMovement.count({ where: { organizationId: org, variantId: { in: ids } } }),
    ).toBe(2);
    expect(
      await prisma.stockReservation.count({
        where: { organizationId: org, referenceId: command.referenceId, status: 'RELEASED' },
      }),
    ).toBe(2);
    await expect(release(command)).rejects.toMatchObject({
      response: { code: 'RESERVATION_NOT_ACTIVE' },
    });
    await expect(reserve({ ...command, items })).rejects.toMatchObject({
      response: { code: 'RESERVATION_ALREADY_EXISTS' },
    });
  });
  it('rolls back every line when any SKU is short, including an absent balance', async () => {
    const created = await stock('5', '5');
    const ordered = await prisma.stockBalance.findMany({
      where: { organizationId: org, variantId: { in: created } },
      orderBy: { id: 'asc' },
    });
    const ids = ordered.map((row) => row.variantId);
    await prisma.$transaction((tx) =>
      ledger.post(tx, {
        organizationId: org,
        warehouseId: warehouse,
        variantId: ids[1]!,
        createdBy: actor,
        referenceId: randomUUID(),
        referenceType: 'ADJUSTMENT_OUT',
        quantityDelta: '-4',
      }),
    );
    const versions = new Map((await balances(ids)).map((row) => [row.id, row.version]));
    const missing = await prisma.productVariant.create({
      data: {
        organizationId: org,
        productId: product,
        sku: randomUUID().toUpperCase(),
        name: 'No balance',
        sellingPrice: '1',
      },
    });
    for (const variantId of [ids[1]!, missing.id]) {
      const command = selection();
      await expect(
        reserve({
          ...command,
          items: [
            { variantId: ids[0]!, quantity: '2' },
            { variantId, quantity: '2' },
          ],
        }),
      ).rejects.toMatchObject({
        response: { code: 'INSUFFICIENT_STOCK', details: { variantId, requested: '2.000' } },
      });
      expect(
        await prisma.stockReservation.count({
          where: { organizationId: org, referenceId: command.referenceId },
        }),
      ).toBe(0);
      expect(
        (await balances(ids)).every((r) => r.reserved.isZero() && r.version === versions.get(r.id)),
      ).toBe(true);
    }
  });
  it('two concurrent reservations cannot both retain the last unit', async () => {
    const [id] = await stock('1');
    const results = await Promise.allSettled(
      Array.from({ length: 2 }, () =>
        reserve({ ...selection(), items: [{ variantId: id!, quantity: '1' }] }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { response: { code: 'INSUFFICIENT_STOCK', details: { available: '0.000' } } },
    });
    expect((await balances([id!]))[0]!.reserved.toFixed(3)).toBe('1.000');
  });
  it('locks reversed multi-SKU requests in the same balance order', async () => {
    const ids = await stock('2', '2');
    await Promise.all(
      [ids, [...ids].reverse()].map((order) =>
        reserve({
          ...selection(),
          items: order.map((variantId) => ({ variantId, quantity: '1' })),
        }),
      ),
    );
    expect((await balances(ids)).every((r) => r.reserved.toFixed(3) === '2.000')).toBe(true);
  });
  it('consumes reservations and posts exact shipment movements in the caller transaction', async () => {
    const ids = await stock('3.125', '3.125'),
      command = selection(),
      shipmentId = randomUUID();
    await reserve({
      ...command,
      items: ids.map((variantId) => ({ variantId, quantity: '1.125' })),
    });
    const input = { ...command, createdBy: actor, shipmentId };
    await expect(
      prisma.$transaction(async (tx) => {
        await service.consume(tx, input);
        throw new Error('Shipment failed');
      }),
    ).rejects.toThrow('Shipment failed');
    expect(
      (await balances(ids)).every(
        (r) => r.reserved.toFixed(3) === '1.125' && r.onHand.toFixed(3) === '3.125',
      ),
    ).toBe(true);
    await consume(input);
    expect(
      (await balances(ids)).every((r) => r.reserved.isZero() && r.onHand.toFixed(3) === '2.000'),
    ).toBe(true);
    const movements = await prisma.stockMovement.findMany({
      where: { organizationId: org, referenceType: 'SHIPMENT_OUT', referenceId: shipmentId },
    });
    expect(movements).toHaveLength(2);
    expect(
      movements.every((r) => r.quantityDelta.toFixed(3) === '-1.125' && r.unitCost === null),
    ).toBe(true);
    await expect(consume(input)).rejects.toMatchObject({
      response: { code: 'RESERVATION_NOT_ACTIVE' },
    });
    await expect(release(command)).rejects.toMatchObject({
      response: { code: 'RESERVATION_NOT_ACTIVE' },
    });
  });
  it('serializes duplicate reserves and a consume/release race without double mutation', async () => {
    const [id] = await stock('3'),
      command = selection(),
      input = { ...command, items: [{ variantId: id!, quantity: '1' }] };
    const attempts = await Promise.allSettled([reserve(input), reserve(input)]);
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { response: { code: 'RESERVATION_ALREADY_EXISTS' } },
    });
    const endings = await Promise.allSettled([
      release(command),
      consume({ ...command, createdBy: actor, shipmentId: randomUUID() }),
    ]);
    expect(endings.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(endings.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { response: { code: 'RESERVATION_NOT_ACTIVE' } },
    });
    const row = (await balances([id!]))[0]!;
    expect(row.reserved.isZero()).toBe(true);
    const sum = await prisma.stockMovement.aggregate({
      where: { organizationId: org, variantId: id },
      _sum: { quantityDelta: true },
    });
    expect(sum._sum.quantityDelta?.equals(row.onHand)).toBe(true);
  });
  it('rejects malformed quantities, repeated variants and cross-organization lookups', async () => {
    const [id] = await stock('5'),
      item = { variantId: id!, quantity: '1', orderItemId: randomUUID() },
      command = selection();
    for (const items of [
      [],
      [item, item],
      [item, { ...item, variantId: id!.toUpperCase() }],
      ...['0', '-1', '0.0001', 'NaN', 'Infinity', '1e2'].map((quantity) => [{ ...item, quantity }]),
    ])
      await expect(
        withTransactionRetry(prisma, (tx) => service.reserve(tx, { ...command, items })),
      ).rejects.toMatchObject({ status: 400 });
    await expect(service.reserve(prisma, { ...command, items: [item] })).rejects.toThrow(
      'caller transaction',
    );
    await expect(
      withTransactionRetry(prisma, (tx) =>
        service.reserve(tx, { ...command, organizationId: other, items: [item] }),
      ),
    ).rejects.toMatchObject({
      response: { code: 'INSUFFICIENT_STOCK', details: { available: '0.000' } },
    });
    await reserve({ ...command, items: [item] });
    await expect(release({ ...command, organizationId: other })).rejects.toMatchObject({
      status: 404,
    });
    expect((await balances([id!]))[0]!.reserved.toFixed(3)).toBe('1.000');
  });
  it('retries the entire transaction after a database serialization failure', async () => {
    const [id] = await stock('2'),
      command = selection();
    let attempts = 0;
    const input = await reservationFixture(prisma, {
      ...command,
      items: [{ variantId: id!, quantity: '1' }],
    });
    await withTransactionRetry(prisma, async (tx) => {
      await service.reserve(tx, input);
      if (++attempts === 1)
        await tx.$executeRaw`DO $$ BEGIN RAISE EXCEPTION 'synthetic conflict' USING ERRCODE = '40001'; END $$`;
    });
    expect(attempts).toBe(2);
    expect((await balances([id!]))[0]!.reserved.toFixed(3)).toBe('1.000');
    expect(
      await prisma.stockReservation.count({
        where: { organizationId: org, referenceId: command.referenceId },
      }),
    ).toBe(1);
  });
  it('stops a terminal transition when reserved no longer matches its active reservation', async () => {
    const [id] = await stock('2'),
      command = selection();
    await reserve({ ...command, items: [{ variantId: id!, quantity: '1' }] });
    const row = (await balances([id!]))[0]!;
    await prisma.stockBalance.update({ where: { id: row.id }, data: { reserved: '0' } });
    await expect(release(command)).rejects.toMatchObject({
      response: { code: 'STOCK_BALANCE_MISMATCH' },
    });
    expect(
      await prisma.stockReservation.count({
        where: { organizationId: org, referenceId: command.referenceId, status: 'ACTIVE' },
      }),
    ).toBe(1);
    expect((await balances([id!]))[0]!.onHand.toFixed(3)).toBe('2.000');
  });
  it('recovers from a real two-connection PostgreSQL deadlock', async () => {
    const ids = (await balances(await stock('1', '1'))).map((row) => row.id);
    let arrivals = 0,
      release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = async (order: string[]) => {
      let attempts = 0;
      await withTransactionRetry(prisma, async (tx) => {
        await tx.$queryRaw`SELECT id FROM stock_balances WHERE id = ${order[0]}::uuid FOR UPDATE`;
        if (++attempts === 1) {
          if (++arrivals === 2) release();
          await barrier;
        }
        await tx.$queryRaw`SELECT id FROM stock_balances WHERE id = ${order[1]}::uuid FOR UPDATE`;
      });
      return attempts;
    };
    const attempts = await Promise.all([run(ids), run([...ids].reverse())]);
    expect(attempts.sort()).toEqual([1, 2]);
  });
  it('stops after three aborted transactions and never retries a business error', async () => {
    const [id] = await stock('2'),
      command = selection();
    let attempts = 0;
    const input = await reservationFixture(prisma, {
      ...command,
      items: [{ variantId: id!, quantity: '1' }],
    });
    await expect(
      withTransactionRetry(prisma, async (tx) => {
        attempts++;
        await service.reserve(tx, input);
        await tx.$executeRaw`DO $$ BEGIN RAISE EXCEPTION 'synthetic conflict' USING ERRCODE = '40P01'; END $$`;
      }),
    ).rejects.toMatchObject({ response: { code: 'TRANSACTION_CONFLICT' } });
    expect(attempts).toBe(3);
    expect((await balances([id!]))[0]!.reserved.isZero()).toBe(true);
    expect(
      await prisma.stockReservation.count({
        where: { organizationId: org, referenceId: command.referenceId },
      }),
    ).toBe(0);
    attempts = 0;
    const shortage = await reservationFixture(prisma, {
      ...selection(),
      items: [{ variantId: id!, quantity: '3' }],
    });
    await expect(
      withTransactionRetry(prisma, async (tx) => {
        attempts++;
        return service.reserve(tx, shortage);
      }),
    ).rejects.toMatchObject({ response: { code: 'INSUFFICIENT_STOCK' } });
    expect(attempts).toBe(1);
  });
});
