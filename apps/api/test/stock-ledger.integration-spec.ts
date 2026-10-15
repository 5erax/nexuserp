import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { parseEnvironment } from '../src/config/environment';
import {
  StockLedgerService,
  type MovementInput,
} from '../src/modules/inventory/application/stock-ledger.service';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service';
import { IdempotentCommand } from '../src/common/idempotency/command';
import { cleanupInventory } from './fixtures/cleanup-inventory';
import { cleanupIam } from './fixtures/cleanup-iam';
import { PasswordService } from '../src/modules/iam/application/password.service';

describe('INV-002/004/005 Stock ledger on PostgreSQL', () => {
  let prisma: PrismaService;
  const ledger = new StockLedgerService();
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
      data: [org, other].map((id) => ({ id, code: 'L-' + id.slice(0, 8), name: 'Ledger fixture' })),
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
        email: 'ledger@example.test',
        displayName: 'Fixture',
        passwordHash: await new PasswordService().hash('synthetic-ledger-password'),
      },
    });
    await prisma.product.create({
      data: { id: product, organizationId: org, name: 'Ledger product' },
    });
  });
  afterAll(async () => {
    if (!prisma) return;
    await cleanupInventory(prisma, [org, other]);
    await cleanupIam(prisma, [org, other]);
    await prisma.$disconnect();
  });
  const variant = async () =>
    (
      await prisma.productVariant.create({
        data: {
          organizationId: org,
          productId: product,
          sku: randomUUID().toUpperCase(),
          name: 'Variant',
          sellingPrice: '1',
        },
      })
    ).id;
  const input = (
    variantId: string,
    quantityDelta = '1',
    referenceType: MovementInput['referenceType'] = 'ADJUSTMENT_IN',
  ): MovementInput => ({
    organizationId: org,
    warehouseId: warehouse,
    variantId,
    createdBy: actor,
    referenceId: randomUUID(),
    referenceType,
    quantityDelta,
  });
  const post = (data: MovementInput) => prisma.$transaction((tx) => ledger.post(tx, data));
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

  it('posts all four movement types with exact decimals and reconciles their sum', async () => {
    const id = await variant();
    const opening = await post({ ...input(id, '10.125', 'OPENING'), unitCost: '123.123456' });
    expect(opening.unitCost?.toFixed(6)).toBe('123.123456');
    await post({ ...input(id, '0.875'), unitCost: '0' });
    await post(input(id, '-1.125', 'ADJUSTMENT_OUT'));
    const shipment = await post(input(id, '-2.875', 'SHIPMENT_OUT'));
    expect(shipment.unitCost).toBeNull();
    const row = await balance(id);
    expect(row.onHand.toFixed(3)).toBe('7.000');
    expect(row.reserved.toFixed(3)).toBe('0.000');
    expect(row.version).toBe(4);
    const sum = await prisma.stockMovement.aggregate({
      where: { organizationId: org, variantId: id },
      _sum: { quantityDelta: true },
    });
    expect(sum._sum.quantityDelta?.equals(row.onHand)).toBe(true);
  });
  it('does not create a balance or movement when a caller transaction rolls back', async () => {
    const id = await variant();
    await expect(ledger.post(prisma, input(id))).rejects.toThrow('requires a caller transaction');
    await expect(
      prisma.$transaction(async (tx) => {
        await ledger.post(tx, input(id));
        throw new Error('Caller failed');
      }),
    ).rejects.toThrow('Caller failed');
    expect(await prisma.stockBalance.count({ where: { organizationId: org, variantId: id } })).toBe(
      0,
    );
    expect(
      await prisma.stockMovement.count({ where: { organizationId: org, variantId: id } }),
    ).toBe(0);
  });
  it('rejects outbound stock beyond available without changing the ledger or version', async () => {
    const id = await variant();
    await post(input(id, '5', 'OPENING'));
    await prisma.stockBalance.update({
      where: { id: (await balance(id)).id },
      data: { reserved: '4.125' },
    });
    await expect(post(input(id, '-0.876', 'ADJUSTMENT_OUT'))).rejects.toMatchObject({
      response: {
        code: 'INSUFFICIENT_STOCK',
        details: { variantId: id, requested: '0.876', available: '0.875' },
      },
    });
    await post(input(id, '-0.875', 'ADJUSTMENT_OUT'));
    const row = await balance(id);
    expect(row.onHand.toFixed(3)).toBe('4.125');
    expect(row.version).toBe(2);
    expect(
      await prisma.stockMovement.count({ where: { organizationId: org, variantId: id } }),
    ).toBe(2);
    const empty = await variant();
    await expect(post(input(empty, '-1', 'SHIPMENT_OUT'))).rejects.toMatchObject({
      response: { code: 'INSUFFICIENT_STOCK' },
    });
    expect(
      await prisma.stockBalance.count({ where: { organizationId: org, variantId: empty } }),
    ).toBe(0);
  });
  it('rolls back a duplicate reference or second opening, even with a different idempotency key', async () => {
    const id = await variant(),
      data = input(id, '1', 'OPENING');
    await post(data);
    await expect(post(data)).rejects.toMatchObject({
      response: { code: 'MOVEMENT_ALREADY_POSTED' },
    });
    await expect(post(input(id, '9', 'OPENING'))).rejects.toMatchObject({
      response: { code: 'MOVEMENT_ALREADY_POSTED' },
    });
    expect((await balance(id)).onHand.toFixed(3)).toBe('1.000');
    expect((await balance(id)).version).toBe(1);
  });
  it('rejects precision loss, invalid signs/types and invalid outbound costs before writing', async () => {
    const id = await variant();
    const invalid: MovementInput[] = [
      input(id, '0'),
      input(id, '-1'),
      input(id, '1', 'ADJUSTMENT_OUT'),
      input(id, '1', 'SHIPMENT_OUT'),
      input(id, '0.0001'),
      input(id, '1000000000000000'),
      input(id, 'NaN'),
      input(id, 'Infinity'),
      input(id, '1e2'),
      { ...input(id), referenceType: 'UNKNOWN' as MovementInput['referenceType'] },
      { ...input(id), unitCost: '-0.000001' },
      { ...input(id), unitCost: '1.0000001' },
      { ...input(id), unitCost: '100000000000000' },
      { ...input(id, '-1', 'ADJUSTMENT_OUT'), unitCost: '0' },
    ];
    for (const data of invalid) await expect(post(data)).rejects.toMatchObject({ status: 400 });
    expect(await prisma.stockBalance.count({ where: { organizationId: org, variantId: id } })).toBe(
      0,
    );
    const exact = await post(input(id, '999999999999999.999'));
    expect(exact.quantityDelta.toFixed(3)).toBe('999999999999999.999');
    await expect(post(input(id, '0.001'))).rejects.toMatchObject({
      response: { code: 'STOCK_LIMIT_EXCEEDED' },
    });
    expect((await balance(id)).onHand.toFixed(3)).toBe('999999999999999.999');
  });
  it('cannot append a movement with foreign organization, warehouse, variant or actor references', async () => {
    const id = await variant();
    for (const data of [
      { ...input(id), organizationId: other },
      { ...input(id), warehouseId: randomUUID() },
      { ...input(id), variantId: randomUUID() },
      { ...input(id), createdBy: randomUUID() },
    ])
      await expect(post(data)).rejects.toThrow();
    expect(
      await prisma.stockMovement.count({ where: { organizationId: org, variantId: id } }),
    ).toBe(0);
    expect(await prisma.stockBalance.count({ where: { organizationId: org, variantId: id } })).toBe(
      0,
    );
  });
  it('concurrent first receipts create one balance and retain every movement', async () => {
    const id = await variant();
    await Promise.all(Array.from({ length: 20 }, () => post(input(id, '0.125'))));
    expect((await balance(id)).onHand.toFixed(3)).toBe('2.500');
    expect((await balance(id)).version).toBe(20);
    expect(
      await prisma.stockMovement.count({ where: { organizationId: org, variantId: id } }),
    ).toBe(20);
  });
  it('concurrent outbound requests cannot spend the same last unit twice', async () => {
    const id = await variant();
    await post(input(id, '1', 'OPENING'));
    const results = await Promise.allSettled([
      post(input(id, '-1', 'SHIPMENT_OUT')),
      post(input(id, '-1', 'SHIPMENT_OUT')),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { response: { code: 'INSUFFICIENT_STOCK' } },
    });
    expect((await balance(id)).onHand.isZero()).toBe(true);
    expect(
      await prisma.stockMovement.count({ where: { organizationId: org, variantId: id } }),
    ).toBe(2);
  });
  it('replays the same idempotent command without a second movement or balance increment', async () => {
    const id = await variant(),
      data = input(id),
      service = new IdempotencyService(prisma);
    const identity = {
      organizationId: org,
      actorId: actor,
      command: 'stock-ledger-fixture',
      key: randomUUID(),
      version: 'v1',
    };
    const command = new IdempotentCommand(
      data,
      async () => {},
      async (tx) => ({ id: (await ledger.post(tx, data)).id }),
    );
    const first = await service.execute(identity, command, 201),
      replay = await service.execute(identity, command, 201);
    expect(replay).toEqual({ ...first, replayed: true });
    expect((await balance(id)).version).toBe(1);
    expect(
      await prisma.stockMovement.count({ where: { organizationId: org, variantId: id } }),
    ).toBe(1);
    await expect(
      prisma.stockMovement.update({ where: { id: first.data.id }, data: { quantityDelta: '99' } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.stockMovement.delete({ where: { id: first.data.id } })).rejects.toThrow(
      /append-only/,
    );
  });
});
