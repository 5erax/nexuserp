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
import { AdjustmentsService } from '../src/modules/inventory/application/adjustments.service';
import { StockLedgerService } from '../src/modules/inventory/application/stock-ledger.service';
import { ReservationsService } from '../src/modules/inventory/application/reservations.service';
import { AuditService } from '../src/modules/audit/application/audit.service';
import { cleanupInventory } from './fixtures/cleanup-inventory';
import { cleanupIam } from './fixtures/cleanup-iam';

describe('INV-004/005/007 Opening and approved stock adjustments', () => {
  let app: INestApplication, prisma: PrismaService;
  let org: string,
    other: string,
    ownerId: string,
    reviewerId: string,
    warehouse: string,
    secondWarehouse: string,
    foreignWarehouse: string,
    product: string,
    staffRole: string;
  type Session = { accessToken: string; csrf: string };
  let owner: Session, staff: Session, reviewer: Session, outsider: Session;
  const config = parseEnvironment({
    ...process.env,
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    NODE_ENV: 'test',
    INVENTORY_APPROVAL_THRESHOLD: '10',
  });
  const call = (
    method: 'get' | 'post',
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
  const variants = async (count = 1) => {
    const data = Array.from({ length: count }, () => ({
      id: randomUUID(),
      organizationId: org,
      productId: product,
      sku: randomUUID().toUpperCase(),
      name: 'Adjustment variant',
      sellingPrice: '1',
    }));
    await prisma.productVariant.createMany({ data });
    return data.map((row) => row.id);
  };
  const draft = async (
    items: { variantId: string; quantityDelta: string; unitCost?: string | null }[],
    session = owner,
    kind = 'OPENING',
    warehouseId = warehouse,
  ) =>
    (
      await call('post', '/inventory/adjustments', session)
        .send({ warehouseId, kind, reason: 'Kiểm kê có chứng từ', items })
        .expect(201)
    ).body.data;
  const action = (id: string, operation: string, session = owner, key?: string) =>
    call('post', '/inventory/adjustments/' + id + '/' + operation, session, key).send({});
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
    expect(app.get(AdjustmentsService)).toBeDefined();
    const code = 'AD-' + randomUUID().slice(0, 8).toUpperCase();
    const own = await bootstrapIam(prisma, {
      organizationCode: code,
      organizationName: 'Adjustment fixture',
      email: 'owner@example.test',
      password: 'synthetic-adjustment-password',
    });
    org = own.organizationId;
    ownerId = own.userId;
    other = (
      await bootstrapIam(prisma, {
        organizationCode: 'AF-' + randomUUID().slice(0, 8).toUpperCase(),
        organizationName: 'Foreign',
        email: 'owner@example.test',
        password: 'synthetic-adjustment-password',
      })
    ).organizationId;
    await prisma.user.updateMany({
      where: { organizationId: { in: [org, other] } },
      data: { mustChangePassword: false },
    });
    const makeWarehouse = async (organizationId: string, code: string) => {
      const branch = await prisma.branch.create({ data: { organizationId, code, name: code } });
      const row = await prisma.warehouse.create({
        data: { organizationId, branchId: branch.id, code, name: code },
      });
      return row;
    };
    const main = await makeWarehouse(org, 'A'),
      second = await makeWarehouse(org, 'B');
    warehouse = main.id;
    secondWarehouse = second.id;
    foreignWarehouse = (await makeWarehouse(other, 'FOREIGN')).id;
    const hash = (await prisma.user.findUniqueOrThrow({ where: { id: ownerId } })).passwordHash;
    const person = async (email: string, roleCode: string, branchId: string) => {
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
        data: { organizationId: org, userId: user.id, branchId },
      });
      return { user, role };
    };
    const employee = await person('staff@example.test', 'WAREHOUSE_STAFF', main.branchId);
    staffRole = employee.role.id;
    reviewerId = (await person('reviewer@example.test', 'BRANCH_MANAGER', main.branchId)).user.id;
    await person('outsider@example.test', 'WAREHOUSE_STAFF', second.branchId);
    const auth = app.get(AuthService),
      csrf = app.get(CsrfService);
    const login = async (email: string) => {
      const result = await auth.login(
        { organizationCode: code, email, password: 'synthetic-adjustment-password' },
        { requestId: 'adjustment-fixture' },
      );
      return { accessToken: result.accessToken, csrf: csrf.issue('family:' + result.familyId) };
    };
    owner = await login('owner@example.test');
    staff = await login('staff@example.test');
    reviewer = await login('reviewer@example.test');
    outsider = await login('outsider@example.test');
    product = (
      await prisma.product.create({ data: { organizationId: org, name: 'Adjustment product' } })
    ).id;
  });
  afterAll(async () => {
    if (prisma && org && other) {
      await cleanupInventory(prisma, [org, other]);
      await cleanupIam(prisma, [org, other]);
    }
    if (app) await app.close();
  });

  it('posts exact opening quantities/costs once and protects posted documents and lines in PostgreSQL', async () => {
    const ids = await variants(2),
      doc = await draft([
        { variantId: ids[0]!, quantityDelta: '1.125', unitCost: null },
        { variantId: ids[1]!, quantityDelta: '1', unitCost: '0' },
      ]);
    const key = randomUUID(),
      posted = await action(doc.id, 'post', owner, key).expect(200);
    expect(posted.body.data.status).toBe('POSTED');
    expect(
      (await action(doc.id, 'post', owner, key).expect(200)).headers['idempotency-replayed'],
    ).toBe('true');
    const movements = await prisma.stockMovement.findMany({
      where: { organizationId: org, referenceId: doc.id },
      orderBy: { variantId: 'asc' },
    });
    expect(movements).toHaveLength(2);
    expect(movements.find((row) => row.variantId === ids[0])!.unitCost).toBeNull();
    expect(movements.find((row) => row.variantId === ids[1])!.unitCost?.toFixed(6)).toBe(
      '0.000000',
    );
    await expect(
      prisma.stockAdjustment.update({ where: { id: doc.id }, data: { reason: 'Rewrite' } }),
    ).rejects.toThrow(/immutable/);
    await expect(prisma.stockAdjustment.delete({ where: { id: doc.id } })).rejects.toThrow(
      /immutable/,
    );
    await expect(
      prisma.stockAdjustmentItem.update({
        where: { id: doc.items[0].id },
        data: { quantityDelta: '9' },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(
      prisma.stockAdjustmentItem.delete({ where: { id: doc.items[0].id } }),
    ).rejects.toThrow(/immutable/);
    const fresh = (await variants())[0]!;
    await expect(
      prisma.stockAdjustmentItem.create({
        data: { organizationId: org, adjustmentId: doc.id, variantId: fresh, quantityDelta: '1' },
      }),
    ).rejects.toThrow(/immutable/);
    const second = await draft([{ variantId: ids[0]!, quantityDelta: '1' }]);
    await expect(
      prisma.stockAdjustmentItem.update({
        where: { id: doc.items[0].id },
        data: { adjustmentId: second.id },
      }),
    ).rejects.toThrow(/immutable/);
    expect((await action(second.id, 'post').expect(409)).body.error.code).toBe(
      'MOVEMENT_ALREADY_POSTED',
    );
    expect(
      (await call('get', '/inventory/adjustments/' + second.id).expect(200)).body.data.status,
    ).toBe('DRAFT');
  });
  it('requires another authorized actor before posting 100 opening lines', async () => {
    const ids = await variants(100),
      doc = await draft(ids.map((variantId) => ({ variantId, quantityDelta: '1' })));
    const submittedKey = randomUUID();
    expect((await action(doc.id, 'post', owner, submittedKey).expect(200)).body.data.status).toBe(
      'PENDING_APPROVAL',
    );
    expect(
      await prisma.stockMovement.count({ where: { organizationId: org, referenceId: doc.id } }),
    ).toBe(0);
    expect((await action(doc.id, 'approve').expect(409)).body.error.code).toBe(
      'SELF_APPROVAL_FORBIDDEN',
    );
    await action(doc.id, 'approve', staff).expect(403);
    await action(doc.id, 'post', outsider).expect(404);
    const approved = await action(doc.id, 'approve', reviewer).expect(200);
    expect(approved.body.data).toMatchObject({
      status: 'APPROVED',
      approvedBy: reviewerId,
      approvalThreshold: '10.000',
      totalAbsoluteQuantity: '100.000',
    });
    expect((await action(doc.id, 'post', owner, submittedKey).expect(200)).body.data.status).toBe(
      'PENDING_APPROVAL',
    );
    expect((await action(doc.id, 'post').expect(200)).body.data.status).toBe('POSTED');
    expect(
      await prisma.stockMovement.count({ where: { organizationId: org, referenceId: doc.id } }),
    ).toBe(100);
  });
  it('snapshots the threshold, includes its boundary and adds absolute quantities instead of netting', async () => {
    const ids = await variants(4);
    const existing = await draft([{ variantId: ids[0]!, quantityDelta: '10' }]);
    config.INVENTORY_APPROVAL_THRESHOLD = '0';
    try {
      const fresh = await draft([{ variantId: ids[1]!, quantityDelta: '0.001' }]);
      expect(fresh.approvalThreshold).toBe('0.000');
      expect((await action(fresh.id, 'post').expect(200)).body.data.status).toBe(
        'PENDING_APPROVAL',
      );
      expect((await action(existing.id, 'post').expect(200)).body.data.status).toBe('POSTED');
    } finally {
      config.INVENTORY_APPROVAL_THRESHOLD = '10';
    }
    const mixed = await draft(
      [
        { variantId: ids[2]!, quantityDelta: '8' },
        { variantId: ids[3]!, quantityDelta: '-8' },
      ],
      staff,
      'ADJUSTMENT',
    );
    expect((await action(mixed.id, 'post', staff).expect(200)).body.data).toMatchObject({
      totalAbsoluteQuantity: '16.000',
      status: 'PENDING_APPROVAL',
    });
  });
  it('scopes adjustment summaries and refuses commands for inactive warehouses or branches', async () => {
    const [id] = await variants();
    const doc = await draft(
      [{ variantId: id!, quantityDelta: '1' }],
      outsider,
      'OPENING',
      secondWarehouse,
    );
    await call('get', '/inventory/adjustments/' + doc.id, staff).expect(404);
    const scoped = (
      await call('get', '/inventory/adjustments?warehouseId=' + secondWarehouse, staff).expect(200)
    ).body;
    expect(scoped.meta.total).toBe(0);
    expect(scoped.data).toEqual([]);
    const sku = (await prisma.productVariant.findUniqueOrThrow({ where: { id } })).sku;
    const own = (
      await call(
        'get',
        '/inventory/adjustments?warehouseId=' + secondWarehouse + '&q=' + sku,
        outsider,
      ).expect(200)
    ).body;
    expect(own.meta.total).toBe(1);
    expect(own.data[0]).toMatchObject({ id: doc.id, itemCount: 1 });
    expect(own.data[0]).not.toHaveProperty('items');
    const branchId = (await prisma.warehouse.findUniqueOrThrow({ where: { id: secondWarehouse } }))
      .branchId;
    for (const target of ['warehouse', 'branch']) {
      if (target === 'warehouse')
        await prisma.warehouse.update({
          where: { id: secondWarehouse },
          data: { status: 'INACTIVE' },
        });
      else await prisma.branch.update({ where: { id: branchId }, data: { status: 'INACTIVE' } });
      try {
        expect((await action(doc.id, 'post', outsider).expect(409)).body.error.code).toBe(
          'WAREHOUSE_INACTIVE',
        );
        await call('post', '/inventory/adjustments', outsider)
          .send({
            warehouseId: secondWarehouse,
            kind: 'OPENING',
            reason: 'Inactive',
            items: [{ variantId: id!, quantityDelta: '1' }],
          })
          .expect(409);
      } finally {
        if (target === 'warehouse')
          await prisma.warehouse.update({
            where: { id: secondWarehouse },
            data: { status: 'ACTIVE' },
          });
        else await prisma.branch.update({ where: { id: branchId }, data: { status: 'ACTIVE' } });
      }
    }
    await prisma.warehouse.update({ where: { id: secondWarehouse }, data: { status: 'INACTIVE' } });
    try {
      await action(doc.id, 'cancel', outsider).expect(200);
    } finally {
      await prisma.warehouse.update({ where: { id: secondWarehouse }, data: { status: 'ACTIVE' } });
    }
  });
  it('rejects empty-command fields and blank rejection reasons before changing state', async () => {
    const [id] = await variants(),
      doc = await draft([{ variantId: id!, quantityDelta: '11' }]);
    for (const operation of ['post', 'approve', 'cancel'])
      await call('post', '/inventory/adjustments/' + doc.id + '/' + operation)
        .send({ status: 'APPROVED' })
        .expect(400);
    await action(doc.id, 'post').expect(200);
    await call('post', '/inventory/adjustments/' + doc.id + '/reject', reviewer)
      .send({ reason: '  ' })
      .expect(400);
    expect(
      (await call('get', '/inventory/adjustments/' + doc.id).expect(200)).body.data.status,
    ).toBe('PENDING_APPROVAL');
  });
  it('cannot add an opening after adjustment history and leaves the earlier stock unchanged', async () => {
    const [id] = await variants();
    const adjustment = await draft([{ variantId: id!, quantityDelta: '1' }], staff, 'ADJUSTMENT');
    await action(adjustment.id, 'post', staff).expect(200);
    const opening = await draft([{ variantId: id!, quantityDelta: '1' }], staff);
    expect((await action(opening.id, 'post', staff).expect(409)).body.error.code).toBe(
      'MOVEMENT_ALREADY_POSTED',
    );
    const row = await prisma.stockBalance.findFirstOrThrow({
      where: { organizationId: org, warehouseId: warehouse, variantId: id },
    });
    expect(row.onHand.toFixed(3)).toBe('1.000');
    expect(row.version).toBe(1);
  });
  it('cancels unposted documents and records a rejection reason without changing stock', async () => {
    const [id] = await variants(),
      cancelled = await draft([{ variantId: id!, quantityDelta: '1' }], staff);
    expect((await action(cancelled.id, 'cancel', staff).expect(200)).body.data.status).toBe(
      'CANCELLED',
    );
    await action(cancelled.id, 'post', staff).expect(409);
    const pending = await draft([{ variantId: id!, quantityDelta: '11' }], staff);
    await action(pending.id, 'post', staff).expect(200);
    const rejected = await call(
      'post',
      '/inventory/adjustments/' + pending.id + '/reject',
      reviewer,
    )
      .send({ reason: ' Sai số liệu kiểm kê ' })
      .expect(200);
    expect(rejected.body.data).toMatchObject({
      status: 'REJECTED',
      decisionReason: 'Sai số liệu kiểm kê',
    });
    await action(pending.id, 'post', staff).expect(409);
    await action(pending.id, 'approve', reviewer).expect(409);
    expect(
      await prisma.stockMovement.count({
        where: { organizationId: org, referenceId: { in: [pending.id, cancelled.id] } },
      }),
    ).toBe(0);
  });
  it('refuses adjustment beyond available and rolls back all posting effects', async () => {
    const [id] = await variants();
    await prisma.$transaction((tx) =>
      app.get(StockLedgerService).post(tx, {
        organizationId: org,
        warehouseId: warehouse,
        variantId: id!,
        createdBy: ownerId,
        referenceId: randomUUID(),
        referenceType: 'OPENING',
        quantityDelta: '10',
      }),
    );
    await prisma.$transaction((tx) =>
      app.get(ReservationsService).reserve(tx, {
        organizationId: org,
        warehouseId: warehouse,
        referenceId: randomUUID(),
        items: [{ variantId: id!, quantity: '4' }],
      }),
    );
    const doc = await draft([{ variantId: id!, quantityDelta: '-7' }], staff, 'ADJUSTMENT');
    expect((await action(doc.id, 'post', staff).expect(409)).body.error.code).toBe(
      'INSUFFICIENT_STOCK',
    );
    expect(
      (await call('get', '/inventory/adjustments/' + doc.id, staff).expect(200)).body.data.status,
    ).toBe('DRAFT');
    expect(
      await prisma.stockMovement.count({ where: { organizationId: org, referenceId: doc.id } }),
    ).toBe(0);
    const valid = await draft([{ variantId: id!, quantityDelta: '-6' }], staff, 'ADJUSTMENT');
    await action(valid.id, 'post', staff).expect(200);
    const row = await prisma.stockBalance.findFirstOrThrow({
      where: { organizationId: org, warehouseId: warehouse, variantId: id },
    });
    expect(row.onHand.toFixed(3)).toBe('4.000');
    expect(row.reserved.toFixed(3)).toBe('4.000');
  });
  it('rejects invalid lines, forged approval fields and foreign warehouses before creating a draft', async () => {
    const [id] = await variants(),
      input = {
        warehouseId: warehouse,
        kind: 'OPENING',
        reason: 'Valid reason',
        items: [{ variantId: id!, quantityDelta: '1' }],
      };
    for (const change of [
      { reason: ' ' },
      { approvalThreshold: '999' },
      { status: 'APPROVED' },
      { items: [] },
      { items: [input.items[0], input.items[0]] },
      { items: [{ variantId: id!, quantityDelta: '-1' }] },
      { items: [{ variantId: id!, quantityDelta: '0.0001' }] },
      { kind: 'ADJUSTMENT', items: [{ variantId: id!, quantityDelta: '-1', unitCost: '0' }] },
    ])
      await call('post', '/inventory/adjustments')
        .send({ ...input, ...change })
        .expect(400);
    await call('post', '/inventory/adjustments')
      .send({ ...input, warehouseId: foreignWarehouse })
      .expect(404);
    await call('post', '/inventory/adjustments')
      .send({ ...input, items: [{ variantId: randomUUID(), quantityDelta: '1' }] })
      .expect(404);
  });
  it('serializes two posting keys and retains exactly one document movement', async () => {
    const [id] = await variants(),
      doc = await draft([{ variantId: id!, quantityDelta: '1' }]);
    const results = await Promise.all([action(doc.id, 'post'), action(doc.id, 'post')]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(
      await prisma.stockMovement.count({ where: { organizationId: org, referenceId: doc.id } }),
    ).toBe(1);
  });
  it('rolls ledger, balance, posted state and idempotency back when audit fails', async () => {
    const [id] = await variants(),
      doc = await draft([{ variantId: id!, quantityDelta: '1' }]),
      key = randomUUID();
    const audit = jest
      .spyOn(app.get(AuditService), 'record')
      .mockRejectedValueOnce(new Error('Synthetic posting audit failure'));
    try {
      await action(doc.id, 'post', owner, key).expect(500);
    } finally {
      audit.mockRestore();
    }
    expect(
      (await call('get', '/inventory/adjustments/' + doc.id).expect(200)).body.data.status,
    ).toBe('DRAFT');
    expect(
      await prisma.stockMovement.count({ where: { organizationId: org, referenceId: doc.id } }),
    ).toBe(0);
    expect(
      await prisma.stockBalance.count({
        where: { organizationId: org, warehouseId: warehouse, variantId: id },
      }),
    ).toBe(0);
    await action(doc.id, 'post', owner, key).expect(200);
  });
  it('denies a cached create after permission removal even if the HTTP guard saw a stale actor', async () => {
    const [id] = await variants(),
      key = randomUUID(),
      input = {
        warehouseId: warehouse,
        kind: 'OPENING',
        reason: 'Permission test',
        items: [{ variantId: id!, quantityDelta: '1' }],
      };
    await call('post', '/inventory/adjustments', staff, key).send(input).expect(201);
    const auth = app.get(AuthService),
      stale = await auth.actor(staff.accessToken);
    const grant = await prisma.rolePermission.findFirstOrThrow({
      where: {
        organizationId: org,
        roleId: staffRole,
        permission: { code: 'inventory.adjustments.create' },
      },
    });
    await prisma.rolePermission.deleteMany({
      where: { organizationId: org, roleId: staffRole, permissionId: grant.permissionId },
    });
    const guard = jest.spyOn(auth, 'actor').mockResolvedValueOnce(stale);
    try {
      await call('post', '/inventory/adjustments', staff, key).send(input).expect(403);
    } finally {
      guard.mockRestore();
      await prisma.rolePermission.create({ data: grant });
    }
  });
});
