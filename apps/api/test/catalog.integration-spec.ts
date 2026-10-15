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
import { cleanupIam } from './fixtures/cleanup-iam';
import { cleanupInventory } from './fixtures/cleanup-inventory';

describe('Catalog HTTP API on PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const config = parseEnvironment({
    ...process.env,
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    NODE_ENV: 'test',
  });
  type Session = Awaited<ReturnType<AuthService['login']>> & { csrfToken: string };
  let owner: Session, foreign: Session, reader: Session;
  let org: string,
    otherOrg: string,
    ownerId: string,
    foreignProduct: string,
    foreignVariant: string,
    productId: string,
    variantId: string,
    secondProduct: string,
    readerRole: string;
  const suffix = randomUUID().slice(0, 8);
  const call = (
    method: 'get' | 'post' | 'patch',
    path: string,
    session = owner,
    key = randomUUID(),
  ) => {
    const client = request(app.getHttpServer());
    const req = client[method]('/api/v1' + path)
      .set('Cookie', `nexus_access=${session.accessToken}; nexus_csrf=${session.csrfToken}`)
      .set('Origin', config.WEB_ORIGIN)
      .set('X-CSRF-Token', session.csrfToken);
    return method === 'post' ? req.set('Idempotency-Key', key) : req;
  };
  const product = (name: string, category?: string) =>
    call('post', '/products').send({ name, category });
  beforeAll(async () => {
    if (
      !process.env.TEST_DATABASE_URL ||
      !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')
    )
      throw new Error('Explicit _test database required');
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENVIRONMENT)
      .useValue(config)
      .compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    const auth = app.get(AuthService),
      csrf = app.get(CsrfService);
    const login = async (organizationCode: string, email: string) => {
      const value = await auth.login(
        { organizationCode, email, password: 'synthetic-catalog-password' },
        { requestId: 'catalog-fixture' },
      );
      return { ...value, csrfToken: csrf.issue('family:' + value.familyId) };
    };
    const code = 'C-' + suffix,
      otherCode = 'F-' + suffix;
    const own = await bootstrapIam(prisma, {
      organizationCode: code,
      organizationName: 'Catalog fixture',
      email: 'owner@example.test',
      password: 'synthetic-catalog-password',
    });
    org = own.organizationId;
    ownerId = own.userId;
    const other = await bootstrapIam(prisma, {
      organizationCode: otherCode,
      organizationName: 'Foreign catalog',
      email: 'owner@example.test',
      password: 'synthetic-catalog-password',
    });
    otherOrg = other.organizationId;
    await prisma.user.updateMany({
      where: { organizationId: { in: [org, otherOrg] } },
      data: { mustChangePassword: false },
    });
    const role = await prisma.role.create({
      data: {
        organizationId: org,
        code: 'CATALOG_READER',
        name: 'Reader',
        permissions: {
          create: [{ permission: { connect: { code: 'catalog.products.read' } }, scope: 'ORG' }],
        },
      },
    });
    readerRole = role.id;
    const hash = (await prisma.user.findUniqueOrThrow({ where: { id: ownerId } })).passwordHash;
    const user = await prisma.user.create({
      data: {
        organizationId: org,
        email: 'reader@example.test',
        displayName: 'Reader',
        passwordHash: hash,
      },
    });
    await prisma.userRole.create({
      data: { organizationId: org, userId: user.id, roleId: readerRole },
    });
    expect(user.organizationId).toBe(org);
    owner = await login(code, 'owner@example.test');
    foreign = await login(otherCode, 'owner@example.test');
    reader = await login(code, 'reader@example.test');
    foreignProduct = (
      await prisma.product.create({ data: { organizationId: otherOrg, name: 'Foreign' } })
    ).id;
  });
  afterAll(async () => {
    if (prisma && org && otherOrg) {
      await cleanupInventory(prisma, [org, otherOrg]);
      await cleanupIam(prisma, [org, otherOrg]);
    }
    if (app) await app.close();
  });
  it('creates a product once on retry and rejects reusing its key for different input', async () => {
    const key = randomUUID();
    const first = await call('post', '/products', owner, key)
      .send({ name: '  Áo khoác  ', category: 'Thời trang', description: null })
      .expect(201);
    productId = first.body.data.id;
    expect(first.body.data).toMatchObject({
      name: 'Áo khoác',
      category: 'Thời trang',
      description: null,
      status: 'ACTIVE',
    });
    const replay = await call('post', '/products', owner, key)
      .send({ name: 'Áo khoác', category: 'Thời trang', description: null })
      .expect(201);
    expect(replay.body.data).toEqual(first.body.data);
    expect(await prisma.product.count({ where: { organizationId: org } })).toBe(1);
    await call('post', '/products', owner, key).send({ name: 'Different' }).expect(409);
    expect(
      await prisma.auditLog.count({
        where: { organizationId: org, action: 'catalog.product_created' },
      }),
    ).toBe(1);
    secondProduct = (await product('Other product').expect(201)).body.data.id;
  });
  it('INV-001 normalizes SKU, preserves exact Decimal values and isolates uniqueness by organization', async () => {
    const input = {
      sku: ' ab-01 ',
      name: 'Size L',
      sellingPrice: '9007199254740993',
      lowStockThreshold: '0.125',
    };
    const first = await call('post', `/products/${productId}/variants`).send(input).expect(201);
    variantId = first.body.data.id;
    expect(first.body.data).toMatchObject({
      sku: 'AB-01',
      sellingPrice: input.sellingPrice,
      lowStockThreshold: '0.125',
    });
    const key = randomUUID();
    const duplicate = await call('post', `/products/${secondProduct}/variants`, owner, key)
      .send(input)
      .expect(409);
    expect(duplicate.body.error.code).toBe('DUPLICATE_SKU');
    await call('post', `/products/${secondProduct}/variants`, owner, key)
      .send({ ...input, sku: 'AB-02' })
      .expect(201);
    foreignVariant = (
      await call('post', `/products/${foreignProduct}/variants`, foreign).send(input).expect(201)
    ).body.data.id;
  });
  it('rejects foreign IDs and filters search/count by organization', async () => {
    await call('get', `/products/${foreignProduct}`).expect(404);
    await call('patch', `/product-variants/${foreignVariant}`).send({ name: 'Hijack' }).expect(404);
    await call('patch', `/products/${foreignProduct}`).send({ name: 'Hijack' }).expect(404);
    await call('post', `/products/${foreignProduct}/variants`)
      .send({ sku: 'BAD', name: 'Foreign', sellingPrice: '0' })
      .expect(404);
    const search = await call('get', '/products?q=ab-01').expect(200);
    expect(search.body.meta.total).toBe(1);
    expect(search.body.data.map((p: { id: string }) => p.id)).toEqual([productId]);
    const variants = await call('get', '/product-variants?q=ab-01').expect(200);
    expect(variants.body.meta.total).toBe(1);
    expect(variants.body.data[0].id).toBe(variantId);
  });
  it('keeps read and manage permissions independent', async () => {
    await call('get', '/products', reader).expect(200);
    await call('post', '/products', reader).send({ name: 'Denied' }).expect(403);
    await call('patch', `/product-variants/${variantId}`, reader)
      .send({ name: 'Denied' })
      .expect(403);
    await prisma.rolePermission.deleteMany({ where: { roleId: readerRole } });
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { code: 'catalog.products.manage' },
    });
    await prisma.rolePermission.create({
      data: { organizationId: org, roleId: readerRole, permissionId: permission.id, scope: 'ORG' },
    });
    await call('get', '/products', reader).expect(403);
    await call('post', '/products', reader).send({ name: 'Manage-only owner' }).expect(201);
  });
  it('paginates and sorts allowlisted fields with category/status filters', async () => {
    const category = 'Sort-' + suffix;
    await product('Beta', category).expect(201);
    await product('Alpha', category).expect(201);
    const first = await call(
      'get',
      `/products?category=${category}&pageSize=1&sortBy=name&sortOrder=asc`,
    ).expect(200);
    const second = await call(
      'get',
      `/products?category=${category}&pageSize=1&page=2&sortBy=name&sortOrder=asc`,
    ).expect(200);
    expect(first.body.data[0].name).toBe('Alpha');
    expect(second.body.data[0].name).toBe('Beta');
    expect(first.body.meta.total).toBe(2);
    for (const query of [
      'page=0',
      'pageSize=101',
      'sortBy=onHand',
      'status=UNKNOWN',
      'organizationId=' + otherOrg,
    ])
      await call('get', '/products?' + query).expect(400);
  });
  it('validates money/quantity strings, partial nulls and unknown write fields', async () => {
    const input = { sku: 'VALID', name: 'Variant', sellingPrice: '0' };
    for (const sellingPrice of [1, '-1', '1e3', '0.5', '9'.repeat(21)])
      await call('post', `/products/${productId}/variants`)
        .send({ ...input, sellingPrice })
        .expect(400);
    for (const lowStockThreshold of ['-0.001', '1.0001', '1e2'])
      await call('post', `/products/${productId}/variants`)
        .send({ ...input, lowStockThreshold })
        .expect(400);
    for (const body of [{ name: null }, { status: null }, { onHand: '1' }, {}])
      await call('patch', `/products/${productId}`).send(body).expect(400);
    await call('patch', `/product-variants/${variantId}`).send({ sellingPrice: null }).expect(400);
    await call('post', '/products')
      .unset('Idempotency-Key')
      .send({ name: 'Missing key' })
      .expect(400);
  });
  it('audits exact price changes and permits SKU changes before stock history', async () => {
    const changed = await call('patch', `/product-variants/${variantId}`)
      .send({ sellingPrice: '123456', sku: ' ab-03 ' })
      .expect(200);
    expect(changed.body.data).toMatchObject({ sku: 'AB-03', sellingPrice: '123456' });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { organizationId: org, entityId: variantId, action: 'catalog.variant_updated' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.changes).toMatchObject({
      before: { sellingPrice: '9007199254740993' },
      after: { sellingPrice: '123456' },
    });
  });
  it('INV-010 refuses changing SKU with stock history while retaining ordinary metadata updates', async () => {
    const branch = await prisma.branch.create({
      data: { organizationId: org, code: 'CATALOG', name: 'Fixture' },
    });
    const warehouse = await prisma.warehouse.create({
      data: { organizationId: org, branchId: branch.id, code: 'CATALOG', name: 'Fixture' },
    });
    await prisma.stockMovement.create({
      data: {
        organizationId: org,
        warehouseId: warehouse.id,
        variantId,
        quantityDelta: '1',
        referenceType: 'OPENING',
        referenceId: randomUUID(),
        createdBy: ownerId,
      },
    });
    const refused = await call('patch', `/product-variants/${variantId}`)
      .send({ sku: 'RENAMED' })
      .expect(409);
    expect(refused.body.error.code).toBe('SKU_HAS_HISTORY');
    await call('patch', `/product-variants/${variantId}`)
      .send({ name: 'Updated label' })
      .expect(200);
  });
  it('archives without deleting history and excludes archived parents from active variant selection', async () => {
    await call('patch', `/products/${productId}`).send({ status: 'INACTIVE' }).expect(200);
    await call('get', `/products/${productId}`).expect(200);
    const active = await call(
      'get',
      `/product-variants?productId=${productId}&status=ACTIVE`,
    ).expect(200);
    expect(active.body.data).toEqual([]);
    const history = await call('get', `/product-variants?productId=${productId}`).expect(200);
    expect(history.body.data[0].id).toBe(variantId);
    await call('post', `/products/${productId}/variants`)
      .send({ sku: 'ARCHIVED', name: 'New', sellingPrice: '0' })
      .expect(409);
    await call('patch', `/products/${productId}`)
      .send({ status: 'ACTIVE', category: null })
      .expect(200);
  });
  it('rolls business data and idempotency back if audit persistence fails', async () => {
    const key = randomUUID(),
      name = 'Rollback-' + suffix;
    const spy = jest
      .spyOn(app.get(AuditService), 'record')
      .mockRejectedValueOnce(new Error('synthetic-audit-failure'));
    try {
      await call('post', '/products', owner, key).send({ name }).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(await prisma.product.count({ where: { organizationId: org, name } })).toBe(0);
    expect(await prisma.idempotencyKey.count({ where: { organizationId: org, key } })).toBe(0);
    await call('post', '/products', owner, key).send({ name }).expect(201);
  });
  it('INV-001 resolves concurrent duplicate SKU requests with one success and one conflict', async () => {
    const input = { sku: 'RACE-' + suffix.toUpperCase(), name: 'Race', sellingPrice: '1' };
    const results = await Promise.all(
      [productId, secondProduct].map((id) => call('post', `/products/${id}/variants`).send(input)),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      await prisma.productVariant.count({ where: { organizationId: org, sku: input.sku } }),
    ).toBe(1);
  });
});
