import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { parseEnvironment } from '../src/config/environment';
import { PasswordService } from '../src/modules/iam/application/password.service';
import { cleanupIam } from './fixtures/cleanup-iam';
import { cleanupInventory } from './fixtures/cleanup-inventory';
describe('Catalog and Inventory PostgreSQL constraints', () => {
  let prisma: PrismaService;
  const org = randomUUID(),
    other = randomUUID(),
    branch = randomUUID(),
    otherBranch = randomUUID(),
    actor = randomUUID(),
    reviewer = randomUUID(),
    otherActor = randomUUID();
  const product = randomUUID(),
    otherProduct = randomUUID(),
    variant = randomUUID(),
    otherVariant = randomUUID(),
    warehouse = randomUUID(),
    otherWarehouse = randomUUID(),
    balance = randomUUID();
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
      data: [
        { id: org, code: 'T-' + org.slice(0, 8), name: 'Inventory fixture' },
        { id: other, code: 'T-' + other.slice(0, 8), name: 'Foreign fixture' },
      ],
    });
    await prisma.branch.createMany({
      data: [
        { id: branch, organizationId: org, code: 'A', name: 'A' },
        { id: otherBranch, organizationId: other, code: 'A', name: 'Foreign' },
      ],
    });
    const passwordHash = await new PasswordService().hash('synthetic-schema-password');
    await prisma.user.createMany({
      data: [
        {
          id: actor,
          organizationId: org,
          email: 'actor@example.test',
          displayName: 'Actor',
          passwordHash,
        },
        {
          id: reviewer,
          organizationId: org,
          email: 'reviewer@example.test',
          displayName: 'Reviewer',
          passwordHash,
        },
        {
          id: otherActor,
          organizationId: other,
          email: 'actor@example.test',
          displayName: 'Foreign',
          passwordHash,
        },
      ],
    });
    await prisma.product.createMany({
      data: [
        { id: product, organizationId: org, name: 'Product' },
        { id: otherProduct, organizationId: other, name: 'Foreign' },
      ],
    });
    await prisma.productVariant.createMany({
      data: [
        {
          id: variant,
          organizationId: org,
          productId: product,
          sku: 'SHARED',
          name: 'Variant',
          sellingPrice: '9007199254740993',
        },
        {
          id: otherVariant,
          organizationId: other,
          productId: otherProduct,
          sku: 'SHARED',
          name: 'Foreign',
          sellingPrice: '1',
        },
      ],
    });
    await prisma.warehouse.createMany({
      data: [
        {
          id: warehouse,
          organizationId: org,
          branchId: branch,
          code: 'MAIN',
          name: 'Main',
          isDefault: true,
        },
        {
          id: otherWarehouse,
          organizationId: other,
          branchId: otherBranch,
          code: 'MAIN',
          name: 'Foreign',
          isDefault: true,
        },
      ],
    });
    await prisma.stockBalance.create({
      data: {
        id: balance,
        organizationId: org,
        warehouseId: warehouse,
        variantId: variant,
        onHand: '10.125',
        reserved: '2.125',
      },
    });
  });
  afterAll(async () => {
    if (!prisma) return;
    await cleanupInventory(prisma, [org, other]);
    await cleanupIam(prisma, [org, other]);
    await prisma.$disconnect();
  });
  const movement = () => ({
    organizationId: org,
    warehouseId: warehouse,
    variantId: variant,
    referenceType: 'ADJUSTMENT_IN',
    referenceId: randomUUID(),
    quantityDelta: '1',
    createdBy: actor,
  });
  it('INV-001 keeps SKU uniqueness within the organization and preserves exact VND values', async () => {
    expect(
      (
        await prisma.productVariant.findUniqueOrThrow({ where: { id: variant } })
      ).sellingPrice.toFixed(0),
    ).toBe('9007199254740993');
    expect(
      await prisma.productVariant.count({
        where: { organizationId: { in: [org, other] }, sku: 'SHARED' },
      }),
    ).toBe(2);
    const input = {
      organizationId: org,
      productId: product,
      sku: 'SHARED',
      name: 'Duplicate',
      sellingPrice: '1',
    };
    await expect(prisma.productVariant.create({ data: input })).rejects.toThrow();
    for (const data of [
      { ...input, sku: ' lower ' },
      { ...input, sku: 'NEGATIVE', sellingPrice: '-1' },
      { ...input, sku: 'THRESHOLD', lowStockThreshold: '-0.001' },
    ])
      await expect(prisma.productVariant.create({ data })).rejects.toThrow();
  });
  it('IAM-004 composite foreign keys reject cross-organization inventory references', async () => {
    await expect(
      prisma.productVariant.create({
        data: {
          organizationId: org,
          productId: otherProduct,
          sku: 'FOREIGN',
          name: 'Foreign',
          sellingPrice: '1',
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.warehouse.create({
        data: { organizationId: org, branchId: otherBranch, code: 'BAD', name: 'Foreign' },
      }),
    ).rejects.toThrow();
    for (const data of [
      { organizationId: org, warehouseId: otherWarehouse, variantId: variant },
      { organizationId: org, warehouseId: warehouse, variantId: otherVariant },
    ])
      await expect(prisma.stockBalance.create({ data })).rejects.toThrow();
    await expect(
      prisma.stockMovement.create({ data: { ...movement(), createdBy: otherActor } }),
    ).rejects.toThrow();
  });
  it('INV-002/003 balances reject negative values and reservation above on-hand', async () => {
    for (const data of [
      { onHand: '-0.001' },
      { reserved: '-0.001' },
      { reserved: '10.126' },
      { version: -1 },
    ])
      await expect(prisma.stockBalance.update({ where: { id: balance }, data })).rejects.toThrow();
    const row = await prisma.stockBalance.findUniqueOrThrow({ where: { id: balance } });
    expect(row.onHand.minus(row.reserved).toFixed(3)).toBe('8.000');
  });
  it('allows only one active default warehouse in each branch', async () => {
    const input = {
      organizationId: org,
      branchId: branch,
      code: 'SECOND',
      name: 'Second',
      isDefault: true,
    };
    await expect(prisma.warehouse.create({ data: input })).rejects.toThrow();
    const inactive = await prisma.warehouse.create({ data: { ...input, status: 'INACTIVE' } });
    await expect(
      prisma.warehouse.update({ where: { id: inactive.id }, data: { status: 'ACTIVE' } }),
    ).rejects.toThrow();
    await prisma.warehouse.create({ data: { ...input, code: 'EXTRA', isDefault: false } });
  });
  it('INV-004/005/010 ledger is immutable, opening is unique and transacted SKU cannot change', async () => {
    const opened = await prisma.stockMovement.create({
      data: { ...movement(), referenceType: 'OPENING', quantityDelta: '10.125', unitCost: null },
    });
    expect(opened.unitCost).toBeNull();
    await expect(
      prisma.stockMovement.update({ where: { id: opened.id }, data: { quantityDelta: '99' } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.stockMovement.delete({ where: { id: opened.id } })).rejects.toThrow(
      /append-only/,
    );
    await expect(
      prisma.stockMovement.create({ data: { ...movement(), referenceType: 'OPENING' } }),
    ).rejects.toThrow();
    await expect(
      prisma.productVariant.update({ where: { id: variant }, data: { sku: 'CHANGED' } }),
    ).rejects.toThrow(/stock history/);
    await prisma.productVariant.update({
      where: { id: otherVariant },
      data: { sku: 'NO-HISTORY' },
    });
    const referenceId = randomUUID();
    await prisma.stockMovement.create({
      data: { ...movement(), referenceId, unitCost: '123.123456' },
    });
    await expect(
      prisma.stockMovement.create({ data: { ...movement(), referenceId } }),
    ).rejects.toThrow();
    for (const data of [
      { ...movement(), quantityDelta: '0' },
      { ...movement(), unitCost: '-0.000001' },
      { ...movement(), referenceType: 'UNKNOWN' },
      { ...movement(), referenceType: 'SHIPMENT_OUT', quantityDelta: '1' },
      { ...movement(), referenceType: 'SHIPMENT_OUT', quantityDelta: '-1', unitCost: '1' },
    ])
      await expect(prisma.stockMovement.create({ data })).rejects.toThrow();
    const inbound = await prisma.stockMovement.findFirstOrThrow({
      where: { organizationId: org, referenceId },
    });
    expect(inbound.unitCost?.toFixed(6)).toBe('123.123456');
  });
  it('reservations enforce quantity and organization without a Sales reference', async () => {
    const input = {
      organizationId: org,
      balanceId: balance,
      referenceId: randomUUID(),
      quantity: '1.125',
    };
    await prisma.stockReservation.create({ data: input });
    await expect(prisma.stockReservation.create({ data: input })).rejects.toThrow();
    for (const data of [
      { ...input, referenceId: randomUUID(), quantity: '0' },
      { ...input, referenceId: randomUUID(), quantity: '-1' },
      { ...input, referenceId: randomUUID(), status: 'UNKNOWN' },
      { ...input, organizationId: other, referenceId: randomUUID() },
    ])
      await expect(prisma.stockReservation.create({ data })).rejects.toThrow();
  });
  it('INV-007 requires adjustment reasons, valid approval actors and lifecycle timestamps', async () => {
    const input = {
      organizationId: org,
      warehouseId: warehouse,
      createdBy: actor,
      kind: 'ADJUSTMENT',
      reason: 'Count correction',
    };
    for (const data of [
      { ...input, reason: ' ' },
      { ...input, approvalThreshold: '-1' },
      { ...input, status: 'POSTED' },
      { ...input, status: 'APPROVED' },
      { ...input, approvedBy: actor, approvedAt: new Date(), status: 'APPROVED' },
      { ...input, approvedBy: otherActor, approvedAt: new Date(), status: 'APPROVED' },
      { ...input, warehouseId: otherWarehouse },
    ])
      await expect(prisma.stockAdjustment.create({ data })).rejects.toThrow();
    const document = await prisma.stockAdjustment.create({
      data: { ...input, status: 'APPROVED', approvedBy: reviewer, approvedAt: new Date() },
    });
    const line = {
      organizationId: org,
      adjustmentId: document.id,
      variantId: variant,
      quantityDelta: '1',
      unitCost: '1.123456',
    };
    for (const data of [
      { ...line, variantId: otherVariant },
      { ...line, organizationId: other },
      { ...line, quantityDelta: '0' },
      { ...line, unitCost: '-1' },
    ])
      await expect(prisma.stockAdjustmentItem.create({ data })).rejects.toThrow();
    await prisma.stockAdjustmentItem.create({ data: line });
    await expect(prisma.stockAdjustmentItem.create({ data: line })).rejects.toThrow();
  });
  it('SAL-010 document sequence increments remain unique under concurrent updates', async () => {
    const key = { organizationId: org, kind: 'ADJ', year: 2026 };
    for (const data of [
      { ...key, nextValue: 0n },
      { ...key, year: 0 },
      { ...key, kind: 'UNKNOWN' },
    ])
      await expect(prisma.documentSequence.create({ data })).rejects.toThrow();
    await prisma.documentSequence.create({ data: key });
    const values = await Promise.all(
      Array.from({ length: 20 }, () =>
        prisma.documentSequence.update({
          where: { organizationId_kind_year: key },
          data: { nextValue: { increment: 1 } },
        }),
      ),
    );
    expect(new Set(values.map((row) => row.nextValue.toString())).size).toBe(20);
    expect(
      (
        await prisma.documentSequence.findUniqueOrThrow({
          where: { organizationId_kind_year: key },
        })
      ).nextValue,
    ).toBe(21n);
  });
});
