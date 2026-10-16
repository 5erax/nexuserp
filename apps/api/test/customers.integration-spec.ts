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
import { CustomersService } from '../src/modules/crm/application/customers.service';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service';
import { cleanupInventory } from './fixtures/cleanup-inventory';
import { cleanupIam } from './fixtures/cleanup-iam';

describe('CRM customers and Sales-scoped transaction history', () => {
  let app: INestApplication, prisma: PrismaService;
  let org: string,
    other: string,
    ownerId: string,
    branch: string,
    secondBranch: string,
    variant: string;
  type Session = { accessToken: string; csrf: string };
  let owner: Session,
    sales: Session,
    peer: Session,
    manager: Session,
    outsider: Session,
    foreign: Session;
  const config = parseEnvironment({
    ...process.env,
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    NODE_ENV: 'test',
  });
  const call = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path = '',
    session = owner,
    key: string = randomUUID(),
  ) => {
    const client = request(app.getHttpServer());
    return client[method]('/api/v1/customers' + path)
      .set('Cookie', `nexus_access=${session.accessToken}; nexus_csrf=${session.csrf}`)
      .set('Origin', config.WEB_ORIGIN)
      .set('X-CSRF-Token', session.csrf)
      .set('Idempotency-Key', key);
  };
  const customer = async (session = owner, extra: object = {}) =>
    (
      await call('post', '', session)
        .send({ branchId: branch, name: 'Khách ' + randomUUID(), ...extra })
        .expect(201)
    ).body.data;
  const order = async (customerId: string, session = sales) =>
    (
      await request(app.getHttpServer())
        .post('/api/v1/sales/orders')
        .set('Cookie', `nexus_access=${session.accessToken}; nexus_csrf=${session.csrf}`)
        .set('Origin', config.WEB_ORIGIN)
        .set('X-CSRF-Token', session.csrf)
        .set('Idempotency-Key', randomUUID())
        .send({ branchId: branch, customerId, items: [{ variantId: variant, quantity: '1' }] })
        .expect(201)
    ).body.data;
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
    const code = 'CR-' + randomUUID().slice(0, 8).toUpperCase();
    const own = await bootstrapIam(prisma, {
      organizationCode: code,
      organizationName: 'CRM fixture',
      email: 'owner@example.test',
      password: 'synthetic-customer-password',
    });
    org = own.organizationId;
    ownerId = own.userId;
    const foreignCode = 'CF-' + randomUUID().slice(0, 8).toUpperCase();
    other = (
      await bootstrapIam(prisma, {
        organizationCode: foreignCode,
        organizationName: 'Foreign CRM fixture',
        email: 'owner@example.test',
        password: 'synthetic-customer-password',
      })
    ).organizationId;
    await prisma.user.updateMany({
      where: { organizationId: { in: [org, other] } },
      data: { mustChangePassword: false },
    });
    branch = (await prisma.branch.create({ data: { organizationId: org, code: 'A', name: 'A' } }))
      .id;
    secondBranch = (
      await prisma.branch.create({ data: { organizationId: org, code: 'B', name: 'B' } })
    ).id;
    await prisma.warehouse.create({
      data: { organizationId: org, branchId: branch, code: 'A', name: 'A', isDefault: true },
    });
    const p = await prisma.product.create({
      data: { organizationId: org, name: 'CRM order product' },
    });
    variant = (
      await prisma.productVariant.create({
        data: {
          organizationId: org,
          productId: p.id,
          sku: 'CRM-SKU',
          name: 'Variant',
          sellingPrice: '100',
        },
      })
    ).id;
    const hash = (await prisma.user.findUniqueOrThrow({ where: { id: ownerId } })).passwordHash;
    const employee = async (email: string, roleCode: string, branchId = branch) => {
      const user = await prisma.user.create({
        data: { organizationId: org, email, displayName: email, passwordHash: hash },
      });
      const role = await prisma.role.findUniqueOrThrow({
        where: { organizationId_code: { organizationId: org, code: roleCode } },
      });
      await prisma.userRole.create({
        data: { organizationId: org, roleId: role.id, userId: user.id },
      });
      await prisma.userBranchAccess.create({
        data: { organizationId: org, branchId, userId: user.id },
      });
    };
    await employee('sales@example.test', 'SALES_STAFF');
    await employee('peer@example.test', 'SALES_STAFF');
    await employee('manager@example.test', 'BRANCH_MANAGER');
    await employee('outside@example.test', 'SALES_STAFF', secondBranch);
    const login = async (email: string, organizationCode = code) => {
      const session = await app
        .get(AuthService)
        .login(
          { organizationCode, email, password: 'synthetic-customer-password' },
          { requestId: 'crm-fixture' },
        );
      return {
        accessToken: session.accessToken,
        csrf: app.get(CsrfService).issue('family:' + session.familyId),
      };
    };
    owner = await login('owner@example.test');
    sales = await login('sales@example.test');
    peer = await login('peer@example.test');
    manager = await login('manager@example.test');
    outsider = await login('outside@example.test');
    foreign = await login('owner@example.test', foreignCode);
  });
  afterAll(async () => {
    if (prisma && org) {
      await cleanupInventory(prisma, [org, ...(other ? [other] : [])]);
      await cleanupIam(prisma, [org, ...(other ? [other] : [])]);
    }
    if (app) await app.close();
  });
  it('normalizes contacts and allows distinct customers to share an email/phone', async () => {
    const email = randomUUID() + '@example.test';
    const a = await customer(sales, {
      name: '  Công ty A  ',
      email: '  ' + email.toUpperCase() + ' ',
      phone: ' +84 900 123 456 ',
    });
    const b = await customer(sales, { name: 'Người liên hệ B', email, phone: '+84 900 123 456' });
    expect(a).toMatchObject({
      name: 'Công ty A',
      email,
      phone: '+84 900 123 456',
      status: 'ACTIVE',
    });
    expect(b.id).not.toBe(a.id);
    expect(
      (await call('get', '?q=' + encodeURIComponent(email), sales).expect(200)).body.meta.total,
    ).toBe(2);
    expect(
      (await call('get', '?q=' + encodeURIComponent('900 123'), sales).expect(200)).body.meta.total,
    ).toBe(2);
    const changed = (
      await call('patch', '/' + b.id, sales)
        .send({ email: null, phone: null, notes: 'Gọi trước khi giao', address: 'Hồ Chí Minh' })
        .expect(200)
    ).body.data;
    expect(changed).toMatchObject({
      email: null,
      phone: null,
      address: 'Hồ Chí Minh',
      notes: 'Gọi trước khi giao',
    });
    expect(
      await prisma.auditLog.count({
        where: { organizationId: org, entityId: b.id, action: 'crm.customer_updated' },
      }),
    ).toBe(1);
  });
  it('filters and paginates customers after applying branch scope', async () => {
    const token = randomUUID();
    const a = await customer(sales, { name: token + ' A' });
    await customer(sales, { name: token + ' B' });
    await customer(owner, { branchId: secondBranch, name: token + ' C' });
    const found = (
      await call('get', '?q=' + token + '&sortBy=name&sortOrder=asc&pageSize=1', sales).expect(200)
    ).body;
    expect(found).toMatchObject({
      data: [expect.objectContaining({ id: a.id })],
      meta: { total: 2, page: 1, pageSize: 1 },
    });
    expect(
      (await call('get', '?q=' + token + '&pageSize=1&page=2', sales).expect(200)).body.data,
    ).toHaveLength(1);
    expect(
      (await call('get', '?q=' + token + '&branchId=' + secondBranch, sales).expect(200)).body,
    ).toMatchObject({ data: [], meta: { total: 0 } });
    expect((await call('get', '?q=' + token, owner).expect(200)).body.meta.total).toBe(3);
    await call('get', '?status=DELETED', sales).expect(400);
  });
  it('refuses cross-branch and cross-organization reads/writes/history', async () => {
    const a = await customer(sales);
    const b = await customer(owner, { branchId: secondBranch });
    for (const [session, target] of [
      [outsider, a.id],
      [sales, b.id],
      [foreign, a.id],
    ] as const) {
      await call('get', '/' + target, session).expect(404);
      await call('get', '/' + target + '/orders', session).expect(404);
      await call('patch', '/' + target, session)
        .send({ name: 'Unauthorized' })
        .expect(404);
    }
    await call('post', '', sales)
      .send({ name: 'Other branch', branchId: secondBranch })
      .expect(404);
    await call('post', '', foreign).send({ name: 'Other tenant', branchId: branch }).expect(404);
    await customer(sales, { branchId: branch.toUpperCase() });
  });
  it('reads Sales history through its public interface with independent OWN/BRANCH scopes', async () => {
    const client = await customer();
    const mine = await order(client.id, sales),
      theirs = await order(client.id, peer);
    const own = (await call('get', '/' + client.id + '/orders', sales).expect(200)).body;
    expect(own.meta.total).toBe(1);
    expect(own.data).toEqual([expect.objectContaining({ id: mine.id, grandTotal: '100' })]);
    expect(own.data[0]).not.toHaveProperty('items');
    const branchView = (
      await call('get', '/' + client.id + '/orders?pageSize=1', manager).expect(200)
    ).body;
    expect(branchView.meta).toMatchObject({ total: 2, pageSize: 1 });
    expect(
      (await call('get', '/' + client.id + '/orders?q=' + theirs.orderNumber, sales).expect(200))
        .body,
    ).toMatchObject({ data: [], meta: { total: 0 } });
    await call('get', '/' + client.id + '/orders?customerId=' + randomUUID(), sales).expect(400);
    const role = await prisma.role.findUniqueOrThrow({
      where: { organizationId_code: { organizationId: org, code: 'SALES_STAFF' } },
    });
    const grant = await prisma.rolePermission.findFirstOrThrow({
      where: { organizationId: org, roleId: role.id, permission: { code: 'sales.orders.read' } },
    });
    await prisma.rolePermission.deleteMany({
      where: { organizationId: org, roleId: role.id, permissionId: grant.permissionId },
    });
    try {
      await call('get', '/' + client.id, sales).expect(200);
      await call('get', '/' + client.id + '/orders', sales).expect(403);
    } finally {
      await prisma.rolePermission.create({ data: grant });
    }
  });
  it('archives an ordered customer without deleting history or allowing new orders', async () => {
    const client = await customer(sales);
    const doc = await order(client.id);
    const inactive = (
      await call('patch', '/' + client.id, sales)
        .send({ status: 'INACTIVE' })
        .expect(200)
    ).body.data;
    expect(inactive.status).toBe('INACTIVE');
    expect(
      (await call('get', '/' + client.id + '/orders', sales).expect(200)).body.data[0].id,
    ).toBe(doc.id);
    expect(
      (
        await call('get', '?q=' + encodeURIComponent(client.name) + '&status=ACTIVE', sales).expect(
          200,
        )
      ).body.data,
    ).toEqual([]);
    await call('delete', '/' + client.id, owner).expect(404);
    await expect(prisma.customer.delete({ where: { id: client.id } })).rejects.toThrow();
    const result = await request(app.getHttpServer())
      .post('/api/v1/sales/orders')
      .set('Cookie', `nexus_access=${owner.accessToken}; nexus_csrf=${owner.csrf}`)
      .set('Origin', config.WEB_ORIGIN)
      .set('X-CSRF-Token', owner.csrf)
      .set('Idempotency-Key', randomUUID())
      .send({
        branchId: branch,
        customerId: client.id,
        items: [{ variantId: variant, quantity: '1' }],
      })
      .expect(409);
    expect(result.body.error.code).toBe('CUSTOMER_INACTIVE');
    await call('patch', '/' + client.id, sales)
      .send({ status: 'ACTIVE' })
      .expect(200);
  });
  it('validates names, nullable fields, emails, body allowlists and immutable identity', async () => {
    for (const extra of [
      { name: '  ' },
      { name: null },
      { name: 'x'.repeat(201) },
      { email: 'invalid' },
      { phone: 'x'.repeat(33) },
      { notes: 'x'.repeat(2001) },
      { status: 'DELETED' },
      { createdBy: ownerId },
      { orders: [] },
    ])
      await call('post')
        .send({ name: 'Valid', branchId: branch, ...extra })
        .expect(400);
    const client = await customer();
    for (const extra of [
      {},
      { name: null },
      { status: null },
      { branchId: secondBranch },
      { createdBy: ownerId },
    ])
      await call('patch', '/' + client.id)
        .send(extra)
        .expect(400);
    await call('get', '?pageSize=101').expect(400);
    await call('post')
      .unset('Idempotency-Key')
      .send({ name: 'Valid', branchId: branch })
      .expect(400);
  });
  it('replays customer creation and rolls back create/update if audit fails', async () => {
    const key = randomUUID(),
      body = { name: 'Replay customer', branchId: branch };
    const first = (await call('post', '', owner, key).send(body).expect(201)).body.data;
    expect((await call('post', '', owner, key).send(body).expect(201)).body.data).toEqual(first);
    expect(
      (
        await call('post', '', owner, key)
          .send({ ...body, name: 'changed' })
          .expect(409)
      ).body.error.code,
    ).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(
      await prisma.auditLog.count({
        where: { organizationId: org, entityId: first.id, action: 'crm.customer_created' },
      }),
    ).toBe(1);
    const failKey = randomUUID(),
      count = await prisma.customer.count({ where: { organizationId: org } });
    const audit = jest
      .spyOn(app.get(AuditService), 'record')
      .mockRejectedValueOnce(new Error('synthetic CRM audit failure'));
    try {
      await call('post', '', owner, failKey).send(body).expect(500);
    } finally {
      audit.mockRestore();
    }
    expect(await prisma.customer.count({ where: { organizationId: org } })).toBe(count);
    expect(
      await prisma.idempotencyKey.count({ where: { organizationId: org, key: failKey } }),
    ).toBe(0);
    const editAudit = jest
      .spyOn(app.get(AuditService), 'record')
      .mockRejectedValueOnce(new Error('synthetic CRM edit audit failure'));
    try {
      await call('patch', '/' + first.id)
        .send({ name: 'lost edit' })
        .expect(500);
    } finally {
      editAudit.mockRestore();
    }
    expect((await call('get', '/' + first.id).expect(200)).body.data).toEqual(first);
  });
  it('keeps long private notes/address out of audit without losing field-change traceability', async () => {
    const client = await customer(sales, {
      name: 'Khách nhiều ghi chú',
      notes: '花'.repeat(2000),
      address: '花'.repeat(1000),
    });
    await call('patch', '/' + client.id, sales)
      .send({ notes: 'Đ'.repeat(2000), address: 'Đ'.repeat(1000) })
      .expect(200);
    const row = await prisma.auditLog.findFirstOrThrow({
      where: { organizationId: org, entityId: client.id, action: 'crm.customer_updated' },
    });
    expect(row.changes).toMatchObject({
      changedFields: expect.arrayContaining(['notes', 'address']),
    });
    expect(JSON.stringify(row.changes)).not.toContain('花');
    expect(JSON.stringify(row.changes)).not.toContain('ĐĐ');
    expect((await call('get', '/' + client.id, sales).expect(200)).body.data.notes).toBe(
      'Đ'.repeat(2000),
    );
  });
  it('reauthorizes branch access inside create and replay transactions', async () => {
    const auth = app.get(AuthService),
      actor = await auth.actor(sales.accessToken),
      customers = app.get(CustomersService),
      idempotency = app.get(IdempotencyService);
    const body = { name: 'Stale actor', branchId: branch },
      key = randomUUID();
    const identity = {
      organizationId: org,
      actorId: actor.id,
      command: 'POST /api/v1/customers',
      key,
      version: '1',
    };
    await idempotency.execute(
      identity,
      customers.create(actor, body, { requestId: 'stale-crm-fixture' }),
      201,
    );
    await prisma.userBranchAccess.delete({
      where: { userId_branchId: { userId: actor.id, branchId: branch } },
    });
    try {
      await expect(
        idempotency.execute(
          identity,
          customers.create(actor, body, { requestId: 'stale-crm-fixture' }),
          201,
        ),
      ).rejects.toMatchObject({ status: 404 });
    } finally {
      await prisma.userBranchAccess.create({
        data: { organizationId: org, userId: actor.id, branchId: branch },
      });
    }
  });
});
