import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { createOpenApi } from '../src/openapi';
import { ENVIRONMENT, parseEnvironment } from '../src/config/environment';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/iam/application/auth.service';
import { CsrfService } from '../src/common/security/csrf.service';
import { bootstrapIam } from '../src/modules/iam/infrastructure/bootstrap-iam';
import { StockLedgerService } from '../src/modules/inventory/application/stock-ledger.service';
import { ReservationsService } from '../src/modules/inventory/application/reservations.service';
import { WarehousesService } from '../src/modules/inventory/application/warehouses.service';
import { AuditService } from '../src/modules/audit/application/audit.service';
import { cleanupInventory } from './fixtures/cleanup-inventory';
import { cleanupIam } from './fixtures/cleanup-iam';

describe('Warehouse management and scoped Inventory HTTP reads', () => {
  let app: INestApplication, prisma: PrismaService;
  let org: string,
    other: string,
    actor: string,
    branchA: string,
    branchB: string,
    foreignBranch: string,
    warehouseA: string,
    warehouseB: string,
    foreignWarehouse: string,
    variant: string,
    secondVariant: string,
    movementReference: string,
    readerRole: string;
  type Session = { accessToken: string; csrf: string };
  let owner: Session, reader: Session, foreign: Session;
  const config = parseEnvironment({
    ...process.env,
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    NODE_ENV: 'test',
  });
  const call = (
    method: 'get' | 'post' | 'patch',
    path: string,
    session = owner,
    key: string = randomUUID(),
  ) => {
    const client = request(app.getHttpServer());
    return client[method]('/api/v1' + path)
      .set('Cookie', `nexus_access=${session.accessToken}; nexus_csrf=${session.csrf}`)
      .set('Origin', config.WEB_ORIGIN)
      .set('X-CSRF-Token', session.csrf)
      .set('Idempotency-Key', key);
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
    const code = 'W-' + randomUUID().slice(0, 8).toUpperCase(),
      otherCode = 'F-' + randomUUID().slice(0, 8).toUpperCase();
    const own = await bootstrapIam(prisma, {
      organizationCode: code,
      organizationName: 'Warehouse fixture',
      email: 'owner@example.test',
      password: 'synthetic-warehouse-password',
    });
    org = own.organizationId;
    actor = own.userId;
    other = (
      await bootstrapIam(prisma, {
        organizationCode: otherCode,
        organizationName: 'Foreign warehouse fixture',
        email: 'owner@example.test',
        password: 'synthetic-warehouse-password',
      })
    ).organizationId;
    await prisma.user.updateMany({
      where: { organizationId: { in: [org, other] } },
      data: { mustChangePassword: false },
    });
    const branch = async (organizationId: string, code: string) =>
      (await prisma.branch.create({ data: { organizationId, code, name: code } })).id;
    branchA = await branch(org, 'A');
    branchB = await branch(org, 'B');
    foreignBranch = await branch(other, 'F');
    const warehouse = async (organizationId: string, branchId: string, code: string) =>
      (
        await prisma.warehouse.create({
          data: { organizationId, branchId, code, name: code, isDefault: true },
        })
      ).id;
    warehouseA = await warehouse(org, branchA, 'MAIN-A');
    warehouseB = await warehouse(org, branchB, 'MAIN-B');
    foreignWarehouse = await warehouse(other, foreignBranch, 'FOREIGN');
    const hash = (await prisma.user.findUniqueOrThrow({ where: { id: actor } })).passwordHash;
    const employee = await prisma.user.create({
      data: {
        organizationId: org,
        email: 'reader@example.test',
        displayName: 'Branch A',
        passwordHash: hash,
      },
    });
    await prisma.userBranchAccess.create({
      data: { organizationId: org, userId: employee.id, branchId: branchA },
    });
    const role = await prisma.role.create({
      data: {
        organizationId: org,
        code: 'STOCK_READER',
        name: 'Stock reader',
        permissions: {
          create: [
            'inventory.warehouses.read',
            'inventory.balances.read',
            'inventory.movements.read',
          ].map((code) => ({ permission: { connect: { code } }, scope: 'BRANCH' })),
        },
      },
    });
    readerRole = role.id;
    await prisma.userRole.create({
      data: { organizationId: org, userId: employee.id, roleId: role.id },
    });
    const auth = app.get(AuthService),
      csrf = app.get(CsrfService);
    const login = async (organizationCode: string, email = 'owner@example.test') => {
      const session = await auth.login(
        { organizationCode, email, password: 'synthetic-warehouse-password' },
        { requestId: 'warehouse-fixture' },
      );
      return { accessToken: session.accessToken, csrf: csrf.issue('family:' + session.familyId) };
    };
    owner = await login(code);
    reader = await login(code, 'reader@example.test');
    foreign = await login(otherCode);
    const product = await prisma.product.create({
      data: { organizationId: org, name: 'Stock product' },
    });
    const item = async (sku: string) =>
      (
        await prisma.productVariant.create({
          data: {
            organizationId: org,
            productId: product.id,
            sku,
            name: sku,
            sellingPrice: '1',
            lowStockThreshold: '8',
          },
        })
      ).id;
    variant = await item('SKU-A');
    secondVariant = await item('SKU-B');
    movementReference = randomUUID();
    for (const [warehouseId, variantId, quantityDelta] of [
      [warehouseA, variant, '10.125'],
      [warehouseA, secondVariant, '2'],
      [warehouseB, variant, '20'],
    ])
      await prisma.$transaction((tx) =>
        app.get(StockLedgerService).post(tx, {
          organizationId: org,
          warehouseId: warehouseId!,
          variantId: variantId!,
          createdBy: actor,
          referenceId:
            warehouseId === warehouseA && variantId === variant ? movementReference : randomUUID(),
          referenceType: 'OPENING',
          quantityDelta: quantityDelta!,
          unitCost: null,
        }),
      );
    await prisma.$transaction((tx) =>
      app.get(ReservationsService).reserve(tx, {
        organizationId: org,
        warehouseId: warehouseA,
        referenceId: randomUUID(),
        items: [{ variantId: variant, quantity: '2.125' }],
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

  it('scopes warehouse, balance and movement counts before pagination to the current branch', async () => {
    const warehouses = await call('get', '/warehouses', reader).expect(200);
    expect(warehouses.body.meta.total).toBe(1);
    expect(warehouses.body.data[0].id).toBe(warehouseA);
    await call('get', '/warehouses/' + warehouseB, reader).expect(404);
    await call('get', '/warehouses/' + foreignWarehouse).expect(404);
    for (const path of ['/inventory/balances', '/inventory/movements']) {
      const timeline = path.endsWith('movements');
      const result = await call(
        'get',
        path + (timeline ? '?limit=1' : '?pageSize=1'),
        reader,
      ).expect(200);
      if (timeline) {
        expect(result.body.meta.nextCursor).toEqual(expect.any(String));
        expect(result.body.meta).not.toHaveProperty('total');
      } else expect(result.body.meta.total).toBe(2);
      expect(result.body.data).toHaveLength(1);
      expect(result.body.data[0].warehouseId).toBe(warehouseA);
      expect(
        (await call('get', path + '?warehouseId=' + warehouseB, reader).expect(200)).body.data,
      ).toEqual([]);
      expect((await call('get', path, foreign).expect(200)).body.data).toEqual([]);
    }
  });
  it('derives exact available quantities and flags the inclusive low-stock threshold', async () => {
    const result = await call(
      'get',
      '/inventory/balances?warehouseId=' + warehouseA + '&variantId=' + variant,
      reader,
    ).expect(200);
    expect(result.body.data).toEqual([
      expect.objectContaining({
        warehouseId: warehouseA,
        branchId: branchA,
        variantId: variant,
        sku: 'SKU-A',
        onHand: '10.125',
        reserved: '2.125',
        available: '8.000',
        lowStockThreshold: '8.000',
        lowStock: true,
      }),
    ]);
    const otherBalance = await call(
      'get',
      '/inventory/balances?warehouseId=' + warehouseB + '&q=sku-a',
    ).expect(200);
    expect(otherBalance.body.data[0]).toMatchObject({ available: '20.000', lowStock: false });
  });
  it('filters movement SKU, source document, kind and date window with stable paging', async () => {
    const filtered = await call(
      'get',
      '/inventory/movements?warehouseId=' +
        warehouseA +
        '&q=sku-a&referenceType=OPENING&referenceId=' +
        movementReference +
        '&from=2020-01-01T00:00:00Z&to=2099-01-01T00:00:00Z',
      reader,
    ).expect(200);
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.meta.nextCursor).toBeNull();
    expect(filtered.body.data[0]).toMatchObject({
      quantityDelta: '10.125',
      unitCost: null,
      referenceType: 'OPENING',
      referenceId: movementReference,
    });
    expect(
      (
        await call(
          'get',
          '/inventory/movements?warehouseId=' + warehouseA + '&referenceType=SHIPMENT_OUT',
        ).expect(200)
      ).body.data,
    ).toEqual([]);
    for (const query of [
      '?from=bad',
      '?from=2099-01-01&to=2020-01-01',
      '?referenceType=UNKNOWN',
      '?limit=101',
      '?limit=0',
      '?pageSize=1',
      '?page=2',
      '?sortOrder=asc',
      '?cursor=bad',
      '?cursor=' +
        Buffer.from(JSON.stringify({ id: randomUUID(), createdAt: 'bad' })).toString('base64url'),
      '?onHand=9',
    ])
      await call('get', '/inventory/movements' + query).expect(400);
    await call('post', '/inventory/balances').send({ onHand: '99' }).expect(404);
  });
  it('keeps cursor boundaries stable when movements append, including equal timestamps', async () => {
    const referenceId = randomUUID();
    const post = (tx: Parameters<StockLedgerService['post']>[0]) =>
      app.get(StockLedgerService).post(tx, {
        organizationId: org,
        warehouseId: warehouseA,
        variantId: variant,
        createdBy: actor,
        referenceId,
        referenceType: 'ADJUSTMENT_IN',
        quantityDelta: '1',
      });
    const otherVariant = secondVariant;
    await prisma.$transaction(async (tx) => {
      await post(tx);
      await app.get(StockLedgerService).post(tx, {
        organizationId: org,
        warehouseId: warehouseA,
        variantId: otherVariant,
        createdBy: actor,
        referenceId,
        referenceType: 'ADJUSTMENT_IN',
        quantityDelta: '1',
      });
    });
    const path = '/inventory/movements?limit=1&referenceId=' + referenceId;
    const first = (await call('get', path, reader).expect(200)).body;
    const initial = await prisma.stockMovement.findMany({
      where: { organizationId: org, referenceId },
    });
    expect(initial[0]!.createdAt).toEqual(initial[1]!.createdAt);
    expect(first.meta.nextCursor).toEqual(expect.any(String));
    await prisma.$transaction((tx) =>
      app.get(StockLedgerService).post(tx, {
        organizationId: org,
        warehouseId: warehouseA,
        variantId: variant,
        createdBy: actor,
        referenceId,
        referenceType: 'ADJUSTMENT_OUT',
        quantityDelta: '-1',
      }),
    );
    const next = (await call('get', path + '&cursor=' + first.meta.nextCursor, reader).expect(200))
      .body;
    expect(next.data).toHaveLength(1);
    expect(new Set([first.data[0].id, next.data[0].id])).toEqual(
      new Set(initial.map((row) => row.id)),
    );
    expect(next.meta.nextCursor).toBeNull();
    expect(
      (await call('get', path + '&cursor=' + first.meta.nextCursor, foreign).expect(200)).body.data,
    ).toEqual([]);
  });
  it('creates a normalized warehouse once and switches the active branch default atomically', async () => {
    const key = randomUUID(),
      input = { branchId: branchA, code: ' extra ', name: ' Extra warehouse ', isDefault: true };
    const created = await call('post', '/warehouses', owner, key).send(input).expect(201);
    const repeated = await call('post', '/warehouses', owner, key).send(input).expect(201);
    expect(repeated.body.data).toEqual(created.body.data);
    expect(repeated.headers['idempotency-replayed']).toBe('true');
    expect(created.body.data).toMatchObject({
      branchId: branchA,
      code: 'EXTRA',
      name: 'Extra warehouse',
      isDefault: true,
    });
    expect(
      (await prisma.warehouse.findUniqueOrThrow({ where: { id: warehouseA } })).isDefault,
    ).toBe(false);
    expect(
      await prisma.warehouse.count({
        where: { organizationId: org, branchId: branchA, status: 'ACTIVE', isDefault: true },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          organizationId: org,
          entityId: created.body.data.id,
          action: 'inventory.warehouse_created',
        },
      }),
    ).toBe(1);
    await call('post', '/warehouses')
      .send({ ...input, name: 'Duplicate' })
      .expect(409);
    await call('post', '/warehouses', reader).send(input).expect(403);
    await call('post', '/warehouses')
      .send({ ...input, branchId: foreignBranch, code: 'FOREIGN' })
      .expect(404);
    await call('post', '/warehouses')
      .send({
        branchId: branchA,
        code: 'BAD-DEFAULT',
        name: 'Invalid default',
        status: 'INACTIVE',
        isDefault: true,
      })
      .expect(400);
    const inactive = await call('post', '/warehouses')
      .send({ branchId: branchA, code: 'SLEEP', name: 'Inactive', status: 'INACTIVE' })
      .expect(201);
    expect(inactive.body.data.isDefault).toBe(false);
    expect(
      (await call('get', '/warehouses?status=INACTIVE&q=sleep', reader).expect(200)).body.meta
        .total,
    ).toBe(1);
  });
  it('does not archive reserved stock and removes the default flag when an idle warehouse is archived', async () => {
    await call('patch', '/warehouses/' + warehouseA)
      .send({ status: 'INACTIVE' })
      .expect(409);
    const archived = await call('patch', '/warehouses/' + warehouseB)
      .send({ status: 'INACTIVE' })
      .expect(200);
    expect(archived.body.data).toMatchObject({ status: 'INACTIVE', isDefault: false });
    await expect(
      prisma.$transaction((tx) => app.get(WarehousesService).lockActive(tx, org, warehouseB)),
    ).rejects.toMatchObject({ response: { code: 'WAREHOUSE_INACTIVE' } });
    await call('patch', '/warehouses/' + warehouseB)
      .send({ status: 'ACTIVE' })
      .expect(200);
    await call('patch', '/warehouses/' + warehouseA)
      .send({ branchId: branchB })
      .expect(400);
    await call('patch', '/warehouses/' + warehouseA)
      .send({ name: null })
      .expect(400);
    await call('patch', '/warehouses/' + warehouseA)
      .send({})
      .expect(400);
  });
  it('rolls back default changes and creation if the audit write fails, then permits retry', async () => {
    const previous = await prisma.warehouse.findFirstOrThrow({
      where: { organizationId: org, branchId: branchA, status: 'ACTIVE', isDefault: true },
    });
    const key = randomUUID(),
      input = { branchId: branchA, code: 'ROLLBACK', name: 'Rollback', isDefault: true };
    const audit = jest
      .spyOn(app.get(AuditService), 'record')
      .mockRejectedValueOnce(new Error('Synthetic audit failure'));
    try {
      await call('post', '/warehouses', owner, key).send(input).expect(500);
    } finally {
      audit.mockRestore();
    }
    expect(await prisma.warehouse.count({ where: { organizationId: org, code: input.code } })).toBe(
      0,
    );
    expect(
      (await prisma.warehouse.findUniqueOrThrow({ where: { id: previous.id } })).isDefault,
    ).toBe(true);
    await call('post', '/warehouses', owner, key).send(input).expect(201);
  });
  it('serializes competing default switches within the same branch', async () => {
    const extra = await prisma.warehouse.findFirstOrThrow({
      where: { organizationId: org, code: 'EXTRA' },
    });
    await Promise.all(
      [warehouseA, extra.id].map((id) =>
        call('patch', '/warehouses/' + id)
          .send({ isDefault: true })
          .expect(200),
      ),
    );
    const defaults = await prisma.warehouse.findMany({
      where: { organizationId: org, branchId: branchA, status: 'ACTIVE', isDefault: true },
    });
    expect(defaults).toHaveLength(1);
    expect([warehouseA, extra.id]).toContain(defaults[0]!.id);
  });
  it('keeps PATCH state fields optional and preserves inactive/default state on a name-only update', async () => {
    const schema = createOpenApi(app).components?.schemas?.UpdateWarehouseInput;
    expect(schema).toMatchObject({
      properties: { status: { type: 'string' }, isDefault: { type: 'boolean' } },
    });
    expect(schema).not.toHaveProperty('properties.status.default');
    expect(schema).not.toHaveProperty('properties.isDefault.default');
    for (const input of [
      {
        branchId: branchA,
        code: 'PATCH-INACTIVE',
        name: 'Inactive before rename',
        status: 'INACTIVE',
        isDefault: false,
      },
      {
        branchId: branchA,
        code: 'PATCH-DEFAULT',
        name: 'Default before rename',
        status: 'ACTIVE',
        isDefault: true,
      },
    ]) {
      const created = await call('post', '/warehouses').send(input).expect(201);
      if (input.status === 'INACTIVE') {
        await call('patch', '/warehouses/' + created.body.data.id)
          .send({ isDefault: true })
          .expect(400);
      }
      const updated = await call('patch', '/warehouses/' + created.body.data.id)
        .send({ name: 'Renamed only' })
        .expect(200);
      expect(updated.body.data).toMatchObject({
        name: 'Renamed only',
        status: input.status,
        isDefault: input.isDefault,
      });
    }
  });
  it('holds both warehouse and branch locks until the caller transaction ends', async () => {
    const service = app.get(WarehousesService);
    await expect(service.lockActive(prisma, org, warehouseA)).rejects.toThrow('caller transaction');
    await expect(
      prisma.$transaction((tx) => service.lockActive(tx, org, foreignWarehouse)),
    ).rejects.toMatchObject({ status: 404 });
    await prisma.$transaction(async (tx) => {
      expect(await service.lockActive(tx, org, warehouseA)).toEqual({
        id: warehouseA,
        branchId: branchA,
      });
      await expect(
        prisma.$transaction(
          (otherTx) =>
            otherTx.$queryRaw`SELECT id FROM warehouses WHERE id = ${warehouseA}::uuid FOR UPDATE NOWAIT`,
        ),
      ).rejects.toThrow(/could not obtain lock/);
      await expect(
        prisma.$transaction(
          (otherTx) =>
            otherTx.$queryRaw`SELECT id FROM branches WHERE id = ${branchA}::uuid FOR UPDATE NOWAIT`,
        ),
      ).rejects.toThrow(/could not obtain lock/);
    });
  });
  it('rechecks current grants and validates branch activity before changing configuration', async () => {
    await prisma.rolePermission.deleteMany({
      where: {
        organizationId: org,
        roleId: readerRole,
        permission: { code: 'inventory.movements.read' },
      },
    });
    await call('get', '/inventory/movements', reader).expect(403);
    await prisma.branch.update({ where: { id: branchB }, data: { status: 'INACTIVE' } });
    try {
      await call('post', '/warehouses')
        .send({ branchId: branchB, code: 'INACTIVE-BRANCH', name: 'Invalid' })
        .expect(409);
      await expect(
        prisma.$transaction((tx) => app.get(WarehousesService).lockActive(tx, org, warehouseB)),
      ).rejects.toMatchObject({ response: { code: 'WAREHOUSE_INACTIVE' } });
    } finally {
      await prisma.branch.update({ where: { id: branchB }, data: { status: 'ACTIVE' } });
    }
  });
});
