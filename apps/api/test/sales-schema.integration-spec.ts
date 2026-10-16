import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { ENVIRONMENT, parseEnvironment } from '../src/config/environment';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/iam/application/auth.service';
import { CsrfService } from '../src/common/security/csrf.service';
import { bootstrapIam } from '../src/modules/iam/infrastructure/bootstrap-iam';
import { StockLedgerService } from '../src/modules/inventory/application/stock-ledger.service';
import { ReservationsService } from '../src/modules/inventory/application/reservations.service';
import { cleanupInventory } from './fixtures/cleanup-inventory';
import { cleanupIam } from './fixtures/cleanup-iam';
import { reservationFixture } from './fixtures/reservation-order';

describe('SAL-001/002/003/008/010 FIN-001/003 CRM/Sales schema and Inventory integration', () => {
  let app: INestApplication, prisma: PrismaService;
  let org: string,
    other: string,
    actor: string,
    foreignActor: string,
    branch: string,
    secondBranch: string,
    warehouse: string,
    secondWarehouse: string,
    foreignBranchWarehouse: string,
    product: string,
    variant: string,
    foreignCustomer: string;
  let accessToken: string, csrf: string;
  const config = parseEnvironment({
    ...process.env,
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    NODE_ENV: 'test',
  });
  const patch = (path: string, body: object) =>
    request(app.getHttpServer())
      .patch('/api/v1' + path)
      .set('Cookie', `nexus_access=${accessToken}; nexus_csrf=${csrf}`)
      .set('Origin', config.WEB_ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send(body);
  const order = async (warehouseId = warehouse, variantId = variant) => {
    const input = await reservationFixture(prisma, {
      organizationId: org,
      warehouseId,
      referenceId: randomUUID(),
      items: [{ variantId, quantity: '1' }],
    });
    return prisma.salesOrder.findUniqueOrThrow({
      where: { id: input.referenceId },
      include: { items: true },
    });
  };
  beforeAll(async () => {
    if (
      !process.env.TEST_DATABASE_URL ||
      !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')
    )
      throw new Error('Explicit _test database required');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENVIRONMENT)
      .useValue(config)
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    const code = 'S-' + randomUUID().slice(0, 8).toUpperCase();
    const own = await bootstrapIam(prisma, {
      organizationCode: code,
      organizationName: 'Sales schema fixture',
      email: 'owner@example.test',
      password: 'synthetic-sales-schema-password',
    });
    org = own.organizationId;
    actor = own.userId;
    const foreign = await bootstrapIam(prisma, {
      organizationCode: 'F-' + randomUUID().slice(0, 8).toUpperCase(),
      organizationName: 'Foreign fixture',
      email: 'owner@example.test',
      password: 'synthetic-sales-schema-password',
    });
    other = foreign.organizationId;
    foreignActor = foreign.userId;
    await prisma.user.update({ where: { id: actor }, data: { mustChangePassword: false } });
    const login = await app.get(AuthService).login(
      {
        organizationCode: code,
        email: 'owner@example.test',
        password: 'synthetic-sales-schema-password',
      },
      { requestId: 'sales-schema-fixture' },
    );
    accessToken = login.accessToken;
    csrf = app.get(CsrfService).issue('family:' + login.familyId);
    branch = (
      await prisma.branch.create({ data: { organizationId: org, code: 'A', name: 'Branch A' } })
    ).id;
    secondBranch = (
      await prisma.branch.create({ data: { organizationId: org, code: 'B', name: 'Branch B' } })
    ).id;
    const foreignBranch = await prisma.branch.create({
      data: { organizationId: other, code: 'F', name: 'Foreign' },
    });
    foreignCustomer = (
      await prisma.customer.create({
        data: {
          organizationId: other,
          branchId: foreignBranch.id,
          createdBy: foreignActor,
          name: 'Foreign customer',
        },
      })
    ).id;
    warehouse = (
      await prisma.warehouse.create({
        data: {
          organizationId: org,
          branchId: branch,
          code: 'A',
          name: 'Warehouse A',
          isDefault: true,
        },
      })
    ).id;
    secondWarehouse = (
      await prisma.warehouse.create({
        data: { organizationId: org, branchId: branch, code: 'A2', name: 'Warehouse A2' },
      })
    ).id;
    foreignBranchWarehouse = (
      await prisma.warehouse.create({
        data: { organizationId: org, branchId: secondBranch, code: 'B', name: 'Warehouse B' },
      })
    ).id;
    product = (
      await prisma.product.create({ data: { organizationId: org, name: 'Snapshot product' } })
    ).id;
    variant = (
      await prisma.productVariant.create({
        data: {
          organizationId: org,
          productId: product,
          sku: 'SCHEMA-SKU',
          name: 'Variant',
          sellingPrice: '1',
        },
      })
    ).id;
    await prisma.$transaction((tx) =>
      app.get(StockLedgerService).post(tx, {
        organizationId: org,
        warehouseId: warehouse,
        variantId: variant,
        createdBy: actor,
        referenceId: randomUUID(),
        referenceType: 'OPENING',
        quantityDelta: '10',
      }),
    );
  });
  afterAll(async () => {
    if (prisma && org && other) {
      await cleanupInventory(prisma, [org, other]);
      await cleanupIam(prisma, [org, other]);
    }
    if (app) await app.close();
  });
  it('enforces customer scope, same-branch references, unique order numbers and valid totals', async () => {
    const doc = await order();
    const base = {
      organizationId: org,
      branchId: branch,
      warehouseId: warehouse,
      customerId: doc.customerId,
      createdBy: actor,
      orderNumber: randomUUID().replaceAll('-', '').toUpperCase(),
    };
    for (const change of [
      { orderNumber: doc.orderNumber },
      { warehouseId: foreignBranchWarehouse },
      { customerId: foreignCustomer },
      { createdBy: foreignActor },
      { status: 'UNKNOWN' },
      { currency: 'USD' },
      { version: -1 },
      { subtotal: '-1', grandTotal: '-1' },
      { subtotal: '1', grandTotal: '2' },
      {
        subtotal: '1',
        discountType: 'AMOUNT',
        discountValue: '2',
        discountTotal: '2',
        grandTotal: '-1',
      },
      { subtotal: '1', taxTotal: '1', grandTotal: '2' },
      { discountType: 'PERCENT', discountValue: '100.001' },
      { discountType: 'AMOUNT', discountValue: '0.001' },
    ])
      await expect(prisma.salesOrder.create({ data: { ...base, ...change } })).rejects.toThrow();
    await expect(prisma.customer.delete({ where: { id: doc.customerId } })).rejects.toThrow();
    await expect(
      prisma.customer.create({
        data: { organizationId: org, branchId: branch, createdBy: actor, name: ' ' },
      }),
    ).rejects.toThrow();
    const duplicate = {
      organizationId: org,
      branchId: branch,
      createdBy: actor,
      name: 'Contact',
      email: 'same@example.test',
      phone: '0900000000',
    };
    await prisma.customer.createMany({ data: [duplicate, duplicate] });
    expect(
      await prisma.customer.count({ where: { organizationId: org, email: duplicate.email } }),
    ).toBe(2);
  });
  it('stores exact Decimal columns and rejects nonpositive quantities, invalid prices and draft delivery', async () => {
    const doc = await order(),
      item = doc.items[0]!;
    for (const data of [
      { quantity: '0', lineTotal: '0' },
      { quantity: '-1' },
      { unitPrice: '-1', lineTotal: '-1' },
      { lineTotal: '2' },
      { deliveredQuantity: '2' },
      { deliveredQuantity: '0.001' },
    ])
      await expect(
        prisma.salesOrderItem.update({ where: { id: item.id }, data }),
      ).rejects.toThrow();
    const columns = await prisma.$queryRaw<
      { table: string; column: string; type: string; scale: number }[]
    >`
      SELECT table_name AS "table", column_name AS "column", data_type AS type, numeric_scale AS scale FROM information_schema.columns
      WHERE table_schema = current_schema() AND (table_name, column_name) IN (('sales_order_items','quantity'),('sales_order_items','unit_price'),('sales_orders','grand_total'),('payments','amount'))`;
    expect(columns).toHaveLength(4);
    expect(columns.every((column) => column.type === 'numeric')).toBe(true);
    expect(columns.find((column) => column.column === 'quantity')!.scale).toBe(3);
    expect(
      columns
        .filter((column) => column.column !== 'quantity')
        .every((column) => column.scale === 0),
    ).toBe(true);
  });
  it('preserves confirmed snapshots and prevents moving or deleting confirmed lines', async () => {
    const doc = await order(),
      target = await order(),
      item = doc.items[0]!;
    await prisma.salesOrder.update({ where: { id: doc.id }, data: { status: 'CONFIRMED' } });
    for (const data of [{ note: 'Rewrite' }, { status: 'DRAFT' }, { warehouseId: secondWarehouse }])
      await expect(prisma.salesOrder.update({ where: { id: doc.id }, data })).rejects.toThrow(
        /immutable/,
      );
    await expect(prisma.salesOrder.delete({ where: { id: doc.id } })).rejects.toThrow();
    for (const data of [
      { sku: 'REWRITE' },
      { quantity: '2', lineTotal: '2' },
      { orderId: target.id },
    ])
      await expect(prisma.salesOrderItem.update({ where: { id: item.id }, data })).rejects.toThrow(
        /immutable/,
      );
    await expect(prisma.salesOrderItem.delete({ where: { id: item.id } })).rejects.toThrow(
      /immutable/,
    );
    await prisma.salesOrderItem.update({
      where: { id: item.id },
      data: { deliveredQuantity: '1' },
    });
    await prisma.salesOrder.update({ where: { id: doc.id }, data: { status: 'FULFILLED' } });
    await expect(
      prisma.salesOrderItem.update({ where: { id: item.id }, data: { deliveredQuantity: '0' } }),
    ).rejects.toThrow(/immutable/);
  });
  it('protects SKU history before any movement and retains the warehouse snapshot when default changes', async () => {
    const fresh = await prisma.productVariant.create({
      data: {
        organizationId: org,
        productId: product,
        sku: 'BEFORE-STOCK',
        name: 'No stock',
        sellingPrice: '1',
      },
    });
    const doc = await order(warehouse, fresh.id);
    expect(
      await prisma.stockMovement.count({ where: { organizationId: org, variantId: fresh.id } }),
    ).toBe(0);
    expect(
      (await patch('/product-variants/' + fresh.id, { sku: 'REWRITE' }).expect(409)).body.error
        .code,
    ).toBe('SKU_HAS_HISTORY');
    await expect(
      prisma.productVariant.update({ where: { id: fresh.id }, data: { sku: 'REWRITE' } }),
    ).rejects.toThrow(/sales history/);
    await patch('/product-variants/' + fresh.id, { name: 'New name', sellingPrice: '2' }).expect(
      200,
    );
    const item = await prisma.salesOrderItem.findUniqueOrThrow({ where: { id: doc.items[0]!.id } });
    expect(item.sku).toBe('BEFORE-STOCK');
    expect(item.unitPrice.toFixed(0)).toBe('1');
    await patch('/warehouses/' + secondWarehouse, { isDefault: true }).expect(200);
    expect((await prisma.salesOrder.findUniqueOrThrow({ where: { id: doc.id } })).warehouseId).toBe(
      warehouse,
    );
    const confirmed = await order(secondWarehouse);
    await prisma.salesOrder.update({ where: { id: confirmed.id }, data: { status: 'CONFIRMED' } });
    expect(
      (await patch('/warehouses/' + secondWarehouse, { status: 'INACTIVE' }).expect(409)).body.error
        .code,
    ).toBe('WAREHOUSE_HAS_ORDERS');
  });
  it('allows one active shipment and prevents cross-order items and posted mutations', async () => {
    const doc = await order(),
      otherOrder = await order();
    const data = { organizationId: org, orderId: doc.id, createdBy: actor };
    const first = await prisma.shipment.create({ data });
    await expect(prisma.shipment.create({ data })).rejects.toThrow();
    await prisma.shipment.update({ where: { id: first.id }, data: { status: 'CANCELLED' } });
    const shipment = await prisma.shipment.create({ data });
    await expect(
      prisma.shipmentItem.create({
        data: {
          organizationId: org,
          shipmentId: shipment.id,
          orderId: doc.id,
          orderItemId: otherOrder.items[0]!.id,
          quantity: '1',
        },
      }),
    ).rejects.toThrow();
    const line = await prisma.shipmentItem.create({
      data: {
        organizationId: org,
        shipmentId: shipment.id,
        orderId: doc.id,
        orderItemId: doc.items[0]!.id,
        quantity: '1',
      },
    });
    await expect(
      prisma.shipment.update({ where: { id: shipment.id }, data: { status: 'POSTED' } }),
    ).rejects.toThrow();
    await prisma.shipment.update({
      where: { id: shipment.id },
      data: { status: 'POSTED', postedAt: new Date() },
    });
    await expect(
      prisma.shipment.update({
        where: { id: shipment.id },
        data: { status: 'DRAFT', postedAt: null },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(
      prisma.shipmentItem.update({ where: { id: line.id }, data: { quantity: '2' } }),
    ).rejects.toThrow(/immutable/);
    await expect(prisma.shipmentItem.delete({ where: { id: line.id } })).rejects.toThrow(
      /immutable/,
    );
  });
  it('makes payments and order events append-only with bounded valid payloads and unique bank references', async () => {
    const doc = await order();
    await prisma.salesOrder.update({ where: { id: doc.id }, data: { status: 'CONFIRMED' } });
    const base = {
      organizationId: org,
      salesOrderId: doc.id,
      createdBy: actor,
      amount: '1',
      method: 'BANK_TRANSFER',
      externalReference: 'REF-1',
      reason: 'Received',
      receivedAt: new Date(),
    };
    const payment = await prisma.payment.create({ data: base });
    for (const change of [
      {},
      { amount: '0', externalReference: 'REF-2' },
      { method: 'UNKNOWN', externalReference: 'REF-2' },
      { externalReference: null },
      { externalReference: ' lower ' },
      { externalReference: 'REF-2', reason: ' ' },
      { externalReference: 'REF-2', createdBy: foreignActor },
    ])
      await expect(prisma.payment.create({ data: { ...base, ...change } })).rejects.toThrow();
    await expect(
      prisma.payment.update({ where: { id: payment.id }, data: { reason: 'Rewrite' } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.payment.delete({ where: { id: payment.id } })).rejects.toThrow(
      /append-only/,
    );
    const eventData = {
      organizationId: org,
      orderId: doc.id,
      actorId: actor,
      action: 'payment.recorded',
      requestId: 'schema-fixture',
      payload: { paymentId: payment.id },
    };
    const event = await prisma.orderEvent.create({ data: eventData });
    await expect(
      prisma.orderEvent.create({ data: { ...eventData, payload: { text: 'x'.repeat(17000) } } }),
    ).rejects.toThrow();
    await expect(
      prisma.orderEvent.update({ where: { id: event.id }, data: { action: 'Rewrite' } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.orderEvent.delete({ where: { id: event.id } })).rejects.toThrow(
      /append-only/,
    );
  });
  it('validates outbox processing leases, published state and bounded payloads', async () => {
    const data = {
      organizationId: org,
      aggregateId: randomUUID(),
      eventType: 'order.confirmed',
      payload: {},
    };
    for (const change of [
      { attempts: -1 },
      { status: 'PROCESSING' },
      { status: 'PUBLISHED' },
      { status: 'UNKNOWN' },
      { lockToken: randomUUID() },
      { payload: { text: 'x'.repeat(17000) } },
    ])
      await expect(prisma.outboxEvent.create({ data: { ...data, ...change } })).rejects.toThrow();
    const event = await prisma.outboxEvent.create({ data });
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: {
        status: 'PROCESSING',
        lockedUntil: new Date(Date.now() + 30000),
        lockToken: randomUUID(),
        attempts: 1,
      },
    });
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: { status: 'PUBLISHED', publishedAt: new Date(), lockedUntil: null, lockToken: null },
    });
  });
  it('requires real same-order/warehouse/variant quantities before retaining ACTIVE stock', async () => {
    const input = await reservationFixture(prisma, {
      organizationId: org,
      warehouseId: warehouse,
      referenceId: randomUUID(),
      items: [{ variantId: variant, quantity: '1' }],
    });
    const reserve = (value: typeof input) =>
      prisma.$transaction((tx) => app.get(ReservationsService).reserve(tx, value));
    await expect(
      reserve({ ...input, items: [{ ...input.items[0]!, quantity: '2' }] }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      reserve({ ...input, items: [{ ...input.items[0]!, orderItemId: randomUUID() }] }),
    ).rejects.toMatchObject({ status: 404 });
    await reserve(input);
    const row = await prisma.stockReservation.findFirstOrThrow({
      where: { organizationId: org, referenceId: input.referenceId },
    });
    expect(row.orderItemId).toBe(input.items[0]!.orderItemId);
    await expect(
      prisma.stockReservation.create({
        data: {
          organizationId: org,
          balanceId: row.balanceId,
          referenceId: randomUUID(),
          quantity: '1',
          orderItemId: null,
        },
      }),
    ).rejects.toThrow();
    await prisma.stockReservation.create({
      data: {
        organizationId: org,
        balanceId: row.balanceId,
        referenceId: randomUUID(),
        quantity: '1',
        status: 'RELEASED',
        orderItemId: null,
      },
    });
  });
});
