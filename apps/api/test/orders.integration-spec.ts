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
import { AuditService } from '../src/modules/audit/application/audit.service';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service';
import { OrdersService } from '../src/modules/sales/application/orders.service';
import { StockLedgerService } from '../src/modules/inventory/application/stock-ledger.service';
import { ReservationsService } from '../src/modules/inventory/application/reservations.service';
import { cleanupInventory } from './fixtures/cleanup-inventory';
import { cleanupIam } from './fixtures/cleanup-iam';

describe('Sales draft orders, pricing and scoped lifecycle API', () => {
  let app: INestApplication, prisma: PrismaService;
  let org: string,
    other: string,
    ownerId: string,
    branch: string,
    secondBranch: string,
    warehouse: string,
    customer: string,
    secondCustomer: string,
    foreignCustomer: string,
    product: string,
    variant: string,
    salesId: string;
  type Session = { accessToken: string; csrf: string };
  let owner: Session, sales: Session, colleague: Session, manager: Session, foreign: Session;
  const config = parseEnvironment({
    ...process.env,
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    NODE_ENV: 'test',
  });
  const call = (
    method: 'get' | 'post' | 'patch',
    path = '',
    session = owner,
    key: string = randomUUID(),
  ) => {
    const client = request(app.getHttpServer());
    return client[method]('/api/v1/sales/orders' + path)
      .set('Cookie', `nexus_access=${session.accessToken}; nexus_csrf=${session.csrf}`)
      .set('Origin', config.WEB_ORIGIN)
      .set('X-CSRF-Token', session.csrf)
      .set('Idempotency-Key', key);
  };
  const input = () => ({
    branchId: branch,
    customerId: customer,
    items: [{ variantId: variant, quantity: '1' }],
  });
  const draft = async (session = owner, overrides: object = {}) =>
    (
      await call('post', '', session)
        .send({ ...input(), ...overrides })
        .expect(201)
    ).body.data;
  const newVariant = async (price = '50') =>
    prisma.productVariant.create({
      data: {
        organizationId: org,
        productId: product,
        sku: randomUUID().toUpperCase(),
        name: 'Variant',
        sellingPrice: price,
      },
    });
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
    const code = 'SO-' + randomUUID().slice(0, 8).toUpperCase();
    const own = await bootstrapIam(prisma, {
      organizationCode: code,
      organizationName: 'Order fixture',
      email: 'owner@example.test',
      password: 'synthetic-order-password',
    });
    org = own.organizationId;
    ownerId = own.userId;
    const foreignCode = 'SF-' + randomUUID().slice(0, 8).toUpperCase();
    const outside = await bootstrapIam(prisma, {
      organizationCode: foreignCode,
      organizationName: 'Foreign order fixture',
      email: 'owner@example.test',
      password: 'synthetic-order-password',
    });
    other = outside.organizationId;
    await prisma.user.updateMany({
      where: { organizationId: { in: [org, other] } },
      data: { mustChangePassword: false },
    });
    branch = (await prisma.branch.create({ data: { organizationId: org, code: 'A', name: 'A' } }))
      .id;
    secondBranch = (
      await prisma.branch.create({ data: { organizationId: org, code: 'B', name: 'B' } })
    ).id;
    warehouse = (
      await prisma.warehouse.create({
        data: { organizationId: org, branchId: branch, code: 'A', name: 'A', isDefault: true },
      })
    ).id;
    await prisma.warehouse.create({
      data: { organizationId: org, branchId: secondBranch, code: 'B', name: 'B', isDefault: true },
    });
    customer = (
      await prisma.customer.create({
        data: { organizationId: org, branchId: branch, createdBy: ownerId, name: 'Order customer' },
      })
    ).id;
    secondCustomer = (
      await prisma.customer.create({
        data: {
          organizationId: org,
          branchId: secondBranch,
          createdBy: ownerId,
          name: 'Other branch customer',
        },
      })
    ).id;
    const foreignBranch = (
      await prisma.branch.create({ data: { organizationId: other, code: 'F', name: 'F' } })
    ).id;
    foreignCustomer = (
      await prisma.customer.create({
        data: {
          organizationId: other,
          branchId: foreignBranch,
          createdBy: outside.userId,
          name: 'Foreign customer',
        },
      })
    ).id;
    product = (
      await prisma.product.create({ data: { organizationId: org, name: 'Snapshot product' } })
    ).id;
    variant = (await newVariant()).id;
    const hash = (await prisma.user.findUniqueOrThrow({ where: { id: ownerId } })).passwordHash;
    const employee = async (email: string, roleCode: string) => {
      const user = await prisma.user.create({
        data: { organizationId: org, email, displayName: email, passwordHash: hash },
      });
      const role = await prisma.role.findUniqueOrThrow({
        where: { organizationId_code: { organizationId: org, code: roleCode } },
      });
      await prisma.userRole.create({
        data: { organizationId: org, userId: user.id, roleId: role.id },
      });
      await prisma.userBranchAccess.create({
        data: { organizationId: org, userId: user.id, branchId: branch },
      });
      return user.id;
    };
    salesId = await employee('sales@example.test', 'SALES_STAFF');
    await employee('colleague@example.test', 'SALES_STAFF');
    await employee('manager@example.test', 'BRANCH_MANAGER');
    const login = async (email: string, organizationCode = code) => {
      const result = await app
        .get(AuthService)
        .login(
          { organizationCode, email, password: 'synthetic-order-password' },
          { requestId: 'order-fixture' },
        );
      return {
        accessToken: result.accessToken,
        csrf: app.get(CsrfService).issue('family:' + result.familyId),
      };
    };
    owner = await login('owner@example.test');
    sales = await login('sales@example.test');
    colleague = await login('colleague@example.test');
    manager = await login('manager@example.test');
    foreign = await login('owner@example.test', foreignCode);
  });
  afterAll(async () => {
    if (prisma && org) {
      await cleanupInventory(prisma, [org, ...(other ? [other] : [])]);
      await cleanupIam(prisma, [org, ...(other ? [other] : [])]);
    }
    if (app) await app.close();
  });
  it('snapshots server prices and rounds each line before the order percentage', async () => {
    const a = await newVariant('1'),
      b = await newVariant('1');
    const doc = await draft(owner, {
      items: [
        { variantId: a.id, quantity: '0.5' },
        { variantId: b.id, quantity: '0.5' },
      ],
      discount: { type: 'PERCENT', value: '25' },
    });
    expect(doc).toMatchObject({
      status: 'DRAFT',
      warehouseId: warehouse,
      currency: 'VND',
      subtotal: '2',
      discountTotal: '1',
      taxTotal: '0',
      grandTotal: '1',
      version: 0,
      itemCount: 2,
    });
    expect(doc.orderNumber).toMatch(/^SO-\d{4}-\d{6,}$/);
    expect(doc.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          unitPrice: '1',
          quantity: '0.500',
          lineTotal: '1',
          productName: 'Snapshot product',
        }),
      ]),
    );
    const events = await prisma.orderEvent.findMany({
      where: { organizationId: org, orderId: doc.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.action).toBe('sales.order_created');
    expect(
      await prisma.auditLog.count({
        where: { organizationId: org, entityId: doc.id, action: 'sales.order_created' },
      }),
    ).toBe(1);
    expect(
      await prisma.stockReservation.count({ where: { organizationId: org, referenceId: doc.id } }),
    ).toBe(0);
  });
  it('replays create without allocating a second number, event or audit', async () => {
    const key = randomUUID(),
      body = input();
    const first = (await call('post', '', owner, key).send(body).expect(201)).body.data;
    expect((await call('post', '', owner, key).send(body).expect(201)).body.data).toEqual(first);
    expect(
      (
        await call('post', '', owner, key)
          .send({ ...body, note: 'changed' })
          .expect(409)
      ).body.error.code,
    ).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(
      await prisma.salesOrder.count({
        where: { organizationId: org, orderNumber: first.orderNumber },
      }),
    ).toBe(1);
    expect(
      await prisma.orderEvent.count({ where: { organizationId: org, orderId: first.id } }),
    ).toBe(1);
    await call('post').unset('Idempotency-Key').send(body).expect(400);
  });
  it('rejects client statuses, warehouse, prices and totals at both DTO levels', async () => {
    const doc = await draft();
    for (const extra of [
      { status: 'CLOSED' },
      { status: 'CONFIRMED' },
      { warehouseId: warehouse },
      { subtotal: '1' },
      { grandTotal: '1' },
      { taxTotal: '1' },
      { unitPrice: '1' },
    ]) {
      await call('post')
        .send({ ...input(), ...extra })
        .expect(400);
      await call('patch', '/' + doc.id)
        .send({ version: doc.version, ...extra })
        .expect(400);
    }
    for (const extra of [{ unitPrice: '1' }, { lineTotal: '1' }, { productName: 'fake' }]) {
      const items = [{ ...input().items[0], ...extra }];
      await call('post')
        .send({ ...input(), items })
        .expect(400);
      await call('patch', '/' + doc.id)
        .send({ version: 0, items })
        .expect(400);
    }
    expect((await call('get', '/' + doc.id).expect(200)).body.data.status).toBe('DRAFT');
  });
  it('rejects invalid/missing lines, duplicate SKUs, malformed quantities and discounts', async () => {
    for (const items of [
      [],
      null,
      [{ variantId: variant, quantity: '0' }],
      [{ variantId: variant, quantity: '-1' }],
      [{ variantId: variant, quantity: '0.0001' }],
      [{ variantId: variant, quantity: 1 }],
      [input().items[0], input().items[0]],
      Array.from({ length: 101 }, () => input().items[0]),
    ])
      await call('post')
        .send({ ...input(), items })
        .expect(400);
    for (const discount of [
      null,
      {},
      { type: 'NONE', value: '1' },
      { type: 'PERCENT', value: '100.01' },
      { type: 'PERCENT', value: '1.001' },
      { type: 'AMOUNT', value: '51' },
      { type: 'AMOUNT', value: '0.1' },
      { type: 'AMOUNT', value: '100000000000000000' },
    ])
      await call('post')
        .send({ ...input(), discount })
        .expect(400);
    await call('post').send({ branchId: branch, customerId: customer }).expect(400);
    await call('post')
      .send({ ...input(), customerId: null })
      .expect(400);
    const huge = await newVariant('99999999999999999999');
    await call('post')
      .send({ ...input(), items: [{ variantId: huge.id, quantity: '2' }] })
      .expect(400);
    expect((await draft(owner, { discount: { type: 'PERCENT', value: '100' } })).grandTotal).toBe(
      '0',
    );
    const free = await newVariant('0');
    expect(
      (
        await draft(owner, {
          items: [{ variantId: free.id, quantity: '0.001' }],
          discount: { type: 'AMOUNT', value: '0' },
        })
      ).grandTotal,
    ).toBe('0');
  });
  it('refreshes draft snapshots on save, retains its warehouse and uses optimistic versions', async () => {
    const v = await newVariant('11');
    const doc = await draft(owner, { items: [{ variantId: v.id, quantity: '2' }], note: 'before' });
    await prisma.productVariant.update({ where: { id: v.id }, data: { sellingPrice: '12' } });
    expect((await call('get', '/' + doc.id).expect(200)).body.data.items[0].unitPrice).toBe('11');
    await prisma.warehouse.update({ where: { id: warehouse }, data: { isDefault: false } });
    const newDefault = await prisma.warehouse.create({
      data: {
        organizationId: org,
        branchId: branch,
        code: randomUUID().slice(0, 8).toUpperCase(),
        name: 'New default',
        isDefault: true,
      },
    });
    try {
      const changed = (
        await call('patch', '/' + doc.id)
          .send({ version: 0, note: null, discount: { type: 'AMOUNT', value: '1' } })
          .expect(200)
      ).body.data;
      expect(changed).toMatchObject({
        version: 1,
        warehouseId: warehouse,
        note: null,
        subtotal: '24',
        grandTotal: '23',
      });
      expect(changed.items[0]).toMatchObject({ unitPrice: '12', lineTotal: '24' });
      expect(
        (
          await call('patch', '/' + doc.id)
            .send({ version: 0, note: 'stale' })
            .expect(409)
        ).body.error.code,
      ).toBe('ORDER_VERSION_CONFLICT');
      await call('patch', '/' + doc.id)
        .send({ note: 'no version' })
        .expect(400);
      await call('patch', '/' + doc.id)
        .send({ version: 1 })
        .expect(400);
      await call('patch', '/' + doc.id)
        .send({ version: 1, branchId: secondBranch })
        .expect(400);
      for (const extra of [{ customerId: null }, { items: null }, { discount: null }])
        await call('patch', '/' + doc.id)
          .send({ version: 1, ...extra })
          .expect(400);
    } finally {
      await prisma.warehouse.update({ where: { id: newDefault.id }, data: { isDefault: false } });
      await prisma.warehouse.update({ where: { id: warehouse }, data: { isDefault: true } });
    }
  });
  it('serializes two edits of one version, committing only one', async () => {
    const doc = await draft();
    const results = await Promise.all(
      ['a', 'b'].map((note) => call('patch', '/' + doc.id).send({ version: 0, note })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('ORDER_VERSION_CONFLICT');
    expect(
      await prisma.orderEvent.count({
        where: { organizationId: org, orderId: doc.id, action: 'sales.order_updated' },
      }),
    ).toBe(1);
  });
  it('allocates unique document numbers under concurrent creation', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => call('post').send(input())));
    expect(results.map((r) => r.status)).toEqual(Array(20).fill(201));
    const numbers = results.map((r) => r.body.data.orderNumber);
    expect(new Set(numbers).size).toBe(20);
    expect(
      await prisma.salesOrder.count({
        where: { organizationId: org, orderNumber: { in: numbers } },
      }),
    ).toBe(20);
  }, 30000);
  it('enforces ORG/BRANCH/OWN scope on create, detail, list, filters and edit', async () => {
    await draft(sales, { branchId: branch.toUpperCase() });
    const mine = await draft(sales),
      theirs = await draft(colleague);
    const otherBranch = await draft(owner, { branchId: secondBranch, customerId: secondCustomer });
    await call('post', '', sales)
      .send({ ...input(), branchId: secondBranch, customerId: secondCustomer })
      .expect(404);
    await call('get', '/' + theirs.id, sales).expect(404);
    await call('patch', '/' + theirs.id, sales)
      .send({ version: 0, note: 'steal' })
      .expect(404);
    await call('get', '/' + otherBranch.id, manager).expect(404);
    await call('patch', '/' + otherBranch.id, manager)
      .send({ version: 0, note: 'steal' })
      .expect(404);
    await call('get', '/' + mine.id, foreign).expect(404);
    await call('patch', '/' + mine.id, foreign)
      .send({ version: 0, note: 'steal' })
      .expect(404);
    expect((await call('get', '?branchId=' + secondBranch, sales).expect(200)).body).toMatchObject({
      data: [],
      meta: { total: 0 },
    });
    expect((await call('get', '?q=' + theirs.orderNumber, sales).expect(200)).body.data).toEqual(
      [],
    );
    await call('get', '/' + mine.id, manager).expect(200);
    await call('get', '/' + theirs.id, manager).expect(200);
    await call('patch', '/' + mine.id, sales)
      .send({ version: 0, note: 'own edit' })
      .expect(200);
  });
  it('filters and paginates summaries without leaking full lines', async () => {
    const doc = await draft();
    const path =
      '?status=DRAFT&branchId=' +
      branch +
      '&customerId=' +
      customer +
      '&q=' +
      doc.orderNumber +
      '&createdFrom=' +
      encodeURIComponent(doc.createdAt) +
      '&createdTo=' +
      encodeURIComponent(doc.createdAt) +
      '&pageSize=1';
    const found = (await call('get', path).expect(200)).body;
    expect(found.meta).toMatchObject({ total: 1, page: 1, pageSize: 1 });
    expect(found.data[0]).toMatchObject({ id: doc.id, itemCount: 1, grandTotal: '50' });
    expect(found.data[0]).not.toHaveProperty('items');
    expect((await call('get', path + '&page=2').expect(200)).body.data).toEqual([]);
    await call('get', '?status=CLOSED').expect(400);
    await call('get', '?createdFrom=2026-02-30').expect(400);
    await call('get', '?createdFrom=2026-02-02&createdTo=2026-01-01').expect(400);
    await call('get', '?pageSize=101').expect(400);
  });
  it('rejects foreign/inactive customers, products and missing default warehouses', async () => {
    for (const customerId of [foreignCustomer, secondCustomer, randomUUID()])
      await call('post')
        .send({ ...input(), customerId })
        .expect(404);
    await prisma.customer.update({ where: { id: customer }, data: { status: 'INACTIVE' } });
    try {
      expect((await call('post').send(input()).expect(409)).body.error.code).toBe(
        'CUSTOMER_INACTIVE',
      );
    } finally {
      await prisma.customer.update({ where: { id: customer }, data: { status: 'ACTIVE' } });
    }
    const v = await newVariant();
    await prisma.productVariant.update({ where: { id: v.id }, data: { status: 'INACTIVE' } });
    expect(
      (
        await call('post')
          .send({ ...input(), items: [{ variantId: v.id, quantity: '1' }] })
          .expect(409)
      ).body.error.code,
    ).toBe('PRODUCT_INACTIVE');
    await call('post')
      .send({ ...input(), items: [{ variantId: randomUUID(), quantity: '1' }] })
      .expect(404);
    await prisma.product.update({ where: { id: product }, data: { status: 'INACTIVE' } });
    try {
      await call('post').send(input()).expect(409);
    } finally {
      await prisma.product.update({ where: { id: product }, data: { status: 'ACTIVE' } });
    }
    await prisma.warehouse.update({ where: { id: warehouse }, data: { isDefault: false } });
    try {
      expect((await call('post').send(input()).expect(409)).body.error.code).toBe(
        'BRANCH_WAREHOUSE_NOT_CONFIGURED',
      );
    } finally {
      await prisma.warehouse.update({ where: { id: warehouse }, data: { isDefault: true } });
    }
  });
  it.each(['CONFIRMED', 'CANCELLED', 'FULFILLED'])(
    'rejects PATCH of %s and preserves original snapshots',
    async (status) => {
      const v = await newVariant('7');
      const doc = await draft(owner, { items: [{ variantId: v.id, quantity: '1' }] });
      if (status === 'FULFILLED')
        await prisma.salesOrder.update({ where: { id: doc.id }, data: { status: 'CONFIRMED' } });
      await prisma.salesOrder.update({ where: { id: doc.id }, data: { status } });
      await prisma.productVariant.update({ where: { id: v.id }, data: { sellingPrice: '99' } });
      expect(
        (
          await call('patch', '/' + doc.id)
            .send({ version: 0, note: 'invalid' })
            .expect(409)
        ).body.error.code,
      ).toBe('INVALID_STATE_TRANSITION');
      expect((await call('get', '/' + doc.id).expect(200)).body.data.items[0]).toMatchObject({
        unitPrice: '7',
        lineTotal: '7',
      });
    },
  );
  it('refuses to replace draft lines that already have reservations', async () => {
    const v = await newVariant();
    const doc = await draft(owner, { items: [{ variantId: v.id, quantity: '1' }] });
    await prisma.$transaction(async (tx) => {
      await app.get(StockLedgerService).post(tx, {
        organizationId: org,
        warehouseId: warehouse,
        variantId: v.id,
        quantityDelta: '1',
        unitCost: null,
        referenceType: 'OPENING',
        referenceId: randomUUID(),
        createdBy: ownerId,
      });
      await app.get(ReservationsService).reserve(tx, {
        organizationId: org,
        warehouseId: warehouse,
        referenceId: doc.id,
        items: [{ variantId: v.id, orderItemId: doc.items[0].id, quantity: '1' }],
      });
    });
    expect(
      (
        await call('patch', '/' + doc.id)
          .send({ version: 0, note: 'invalid' })
          .expect(409)
      ).body.error.code,
    ).toBe('INVALID_STATE_TRANSITION');
    expect(
      await prisma.stockReservation.count({
        where: { organizationId: org, referenceId: doc.id, status: 'ACTIVE' },
      }),
    ).toBe(1);
  });
  it('rolls back document, lines, number, event and idempotency when audit fails', async () => {
    const before = await prisma.salesOrder.count({ where: { organizationId: org } });
    const sequences = await prisma.documentSequence.findMany({ where: { organizationId: org } });
    const key = randomUUID();
    const audit = jest
      .spyOn(app.get(AuditService), 'record')
      .mockRejectedValueOnce(new Error('synthetic audit failure'));
    try {
      await call('post', '', owner, key).send(input()).expect(500);
    } finally {
      audit.mockRestore();
    }
    expect(await prisma.salesOrder.count({ where: { organizationId: org } })).toBe(before);
    expect(await prisma.documentSequence.findMany({ where: { organizationId: org } })).toEqual(
      sequences,
    );
    expect(await prisma.idempotencyKey.count({ where: { organizationId: org, key } })).toBe(0);
    await call('post', '', owner, key).send(input()).expect(201);
    const doc = await draft();
    const auditService = app.get(AuditService);
    const writeAudit = auditService.record.bind(auditService);
    const editAudit = jest
      .spyOn(auditService, 'record')
      .mockImplementationOnce(writeAudit)
      .mockRejectedValueOnce(new Error('synthetic edit audit failure'));
    try {
      await call('patch', '/' + doc.id)
        .send({ version: 0, items: [{ variantId: variant, quantity: '2' }] })
        .expect(500);
    } finally {
      editAudit.mockRestore();
    }
    expect((await call('get', '/' + doc.id).expect(200)).body.data).toEqual(doc);
    expect(await prisma.orderEvent.count({ where: { organizationId: org, orderId: doc.id } })).toBe(
      1,
    );
  });
  it('reauthorizes stale actors inside the transaction, including idempotent replays', async () => {
    const auth = app.get(AuthService);
    const actor = await auth.actor(sales.accessToken);
    const body = input(),
      key = randomUUID();
    const identity = {
      organizationId: org,
      actorId: salesId,
      command: 'POST /api/v1/sales/orders',
      key,
      version: '1',
    };
    const orders = app.get(OrdersService),
      idempotency = app.get(IdempotencyService);
    await idempotency.execute(
      identity,
      orders.create(actor, body, { requestId: 'stale-fixture' }),
      201,
    );
    await prisma.userBranchAccess.delete({
      where: { userId_branchId: { userId: salesId, branchId: branch } },
    });
    try {
      await expect(
        idempotency.execute(
          identity,
          orders.create(actor, body, { requestId: 'stale-fixture' }),
          201,
        ),
      ).rejects.toMatchObject({ status: 404 });
    } finally {
      await prisma.userBranchAccess.create({
        data: { organizationId: org, userId: salesId, branchId: branch },
      });
    }
    const role = await prisma.role.findUniqueOrThrow({
      where: { organizationId_code: { organizationId: org, code: 'SALES_STAFF' } },
    });
    const grant = await prisma.rolePermission.findFirstOrThrow({
      where: { organizationId: org, roleId: role.id, permission: { code: 'sales.orders.create' } },
    });
    await prisma.rolePermission.deleteMany({
      where: { organizationId: org, roleId: role.id, permissionId: grant.permissionId },
    });
    try {
      await expect(
        idempotency.execute(
          identity,
          orders.create(actor, body, { requestId: 'stale-fixture' }),
          201,
        ),
      ).rejects.toMatchObject({ status: 403 });
    } finally {
      await prisma.rolePermission.create({ data: grant });
    }
  });
  it('accepts 100 long-name SKU lines without exceeding bounded audit/event payloads', async () => {
    const p = await prisma.product.create({
      data: { organizationId: org, name: '花'.repeat(200) },
    });
    const rows = Array.from({ length: 100 }, () => ({
      id: randomUUID(),
      organizationId: org,
      productId: p.id,
      sku: randomUUID().toUpperCase(),
      name: 'V'.repeat(200),
      sellingPrice: '1',
    }));
    await prisma.productVariant.createMany({ data: rows });
    const doc = await draft(owner, {
      items: rows.map((row) => ({ variantId: row.id, quantity: '1' })),
      note: '\u0001'.repeat(2000),
    });
    expect(doc).toMatchObject({ itemCount: 100, grandTotal: '100' });
    expect(doc.items).toHaveLength(100);
    await call('patch', '/' + doc.id)
      .send({
        version: 0,
        items: rows.map((row) => ({ variantId: row.id, quantity: '2' })),
        note: '\u0002'.repeat(2000),
      })
      .expect(200);
    const changes = await prisma.auditLog.findMany({
      where: { organizationId: org, entityId: doc.id, action: 'sales.order_items_updated' },
    });
    const lines = changes.flatMap((row) => (row.changes as { items: unknown[] }).items);
    expect(lines).toHaveLength(100);
    expect(
      await prisma.orderEvent.count({
        where: { organizationId: org, orderId: doc.id, action: 'sales.order_note_updated' },
      }),
    ).toBe(2);
  });
  it('edits drafts against an inactive snapshotted warehouse without selecting a replacement', async () => {
    const b = await prisma.branch.create({
      data: {
        organizationId: org,
        code: 'ED-' + randomUUID().slice(0, 8).toUpperCase(),
        name: 'Draft warehouse branch',
      },
    });
    const wh = await prisma.warehouse.create({
      data: {
        organizationId: org,
        branchId: b.id,
        code: 'ED-' + randomUUID().slice(0, 8).toUpperCase(),
        name: 'Draft warehouse',
        isDefault: true,
      },
    });
    const client = await prisma.customer.create({
      data: {
        organizationId: org,
        branchId: b.id,
        createdBy: ownerId,
        name: 'Draft warehouse customer',
      },
    });
    const doc = await draft(owner, { branchId: b.id, customerId: client.id });
    await request(app.getHttpServer())
      .patch('/api/v1/warehouses/' + wh.id)
      .set('Cookie', `nexus_access=${owner.accessToken}; nexus_csrf=${owner.csrf}`)
      .set('Origin', config.WEB_ORIGIN)
      .set('X-CSRF-Token', owner.csrf)
      .send({ status: 'INACTIVE' })
      .expect(200);
    const edited = (
      await call('patch', '/' + doc.id)
        .send({ version: 0, note: 'Editable draft' })
        .expect(200)
    ).body.data;
    expect(edited).toMatchObject({
      warehouseId: wh.id,
      note: 'Editable draft',
      version: 1,
      status: 'DRAFT',
    });
  });
  it('records actual customer, note, discount and equally-priced variant changes', async () => {
    const a = await newVariant('50'),
      b = await newVariant('50');
    const client = await prisma.customer.create({
      data: { organizationId: org, branchId: branch, createdBy: ownerId, name: 'Changed customer' },
    });
    const doc = await draft(owner, {
      items: [{ variantId: a.id, quantity: '1' }],
      note: 'Before note',
    });
    await call('patch', '/' + doc.id)
      .send({
        version: 0,
        customerId: client.id,
        items: [{ variantId: b.id, quantity: '1' }],
        note: 'After note',
        discount: { type: 'AMOUNT', value: '1' },
      })
      .expect(200);
    const logs = await prisma.auditLog.findMany({
      where: { organizationId: org, entityId: doc.id },
    });
    expect(logs.find((row) => row.action === 'sales.order_updated')!.changes).toMatchObject({
      before: { customerId: customer, discountType: 'NONE', grandTotal: '50' },
      after: { customerId: client.id, discountType: 'AMOUNT', grandTotal: '49' },
    });
    const itemChanges = logs
      .filter((row) => row.action === 'sales.order_items_updated')
      .flatMap((row) => (row.changes as { items: unknown[] }).items);
    expect(itemChanges).toEqual(
      expect.arrayContaining([
        {
          before: expect.objectContaining({ variantId: a.id, unitPrice: '50', quantity: '1.000' }),
          after: null,
        },
        {
          before: null,
          after: expect.objectContaining({ variantId: b.id, unitPrice: '50', quantity: '1.000' }),
        },
      ]),
    );
    const notes = logs
      .filter((row) => row.action === 'sales.order_note_updated')
      .map((row) => row.changes);
    expect(notes).toEqual(
      expect.arrayContaining([
        { before: { note: 'Before note' } },
        { after: { note: 'After note' } },
      ]),
    );
  });
});
