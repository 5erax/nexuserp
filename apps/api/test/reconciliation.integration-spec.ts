import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { ENVIRONMENT, parseEnvironment } from '../src/config/environment';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { ReconciliationService } from '../src/modules/inventory/application/reconciliation.service';
import { StockLedgerService } from '../src/modules/inventory/application/stock-ledger.service';
import { ReservationsService } from '../src/modules/inventory/application/reservations.service';
import { AuthService } from '../src/modules/iam/application/auth.service';
import { bootstrapIam } from '../src/modules/iam/infrastructure/bootstrap-iam';
import { cleanupInventory } from './fixtures/cleanup-inventory';
import { cleanupIam } from './fixtures/cleanup-iam';
import { reservationFixture } from './fixtures/reservation-order';

describe('Inventory reconciliation HTTP and CLI', () => {
  let app: INestApplication, prisma: PrismaService, reconciliation: ReconciliationService;
  let org: string,
    other: string,
    actor: string,
    warehouse: string,
    emptyWarehouse: string,
    foreignWarehouse: string;
  let first: string, second: string, product: string, branchRole: string;
  let ownerToken: string, foreignToken: string, readerToken: string;
  const config = parseEnvironment({
    ...process.env,
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    NODE_ENV: 'test',
  });
  const get = (query = '', token = ownerToken) =>
    request(app.getHttpServer())
      .get('/api/v1/inventory/reconciliation' + query)
      .set('Cookie', 'nexus_access=' + token);
  const cli = (...args: string[]) =>
    spawnSync(
      process.execPath,
      [
        require.resolve('ts-node/dist/bin.js'),
        resolve(__dirname, '../scripts/reconcile-inventory.ts'),
        ...args,
      ],
      {
        cwd: resolve(__dirname, '..'),
        env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
        encoding: 'utf8',
      },
    );
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
    reconciliation = app.get(ReconciliationService);
    const code = 'RC-' + randomUUID().slice(0, 8).toUpperCase(),
      foreignCode = 'RF-' + randomUUID().slice(0, 8).toUpperCase();
    const own = await bootstrapIam(prisma, {
      organizationCode: code,
      organizationName: 'Reconciliation',
      email: 'owner@example.test',
      password: 'synthetic-reconciliation-pass',
    });
    org = own.organizationId;
    actor = own.userId;
    const foreign = await bootstrapIam(prisma, {
      organizationCode: foreignCode,
      organizationName: 'Foreign',
      email: 'owner@example.test',
      password: 'synthetic-reconciliation-pass',
    });
    other = foreign.organizationId;
    await prisma.user.updateMany({
      where: { organizationId: { in: [org, other] } },
      data: { mustChangePassword: false },
    });
    const hash = (await prisma.user.findUniqueOrThrow({ where: { id: actor } })).passwordHash;
    const reader = await prisma.user.create({
      data: {
        organizationId: org,
        email: 'reader@example.test',
        displayName: 'Reader',
        passwordHash: hash,
      },
    });
    const role = await prisma.role.create({
      data: {
        organizationId: org,
        code: 'BRANCH_READER',
        name: 'Branch reader',
        permissions: {
          create: [
            { permission: { connect: { code: 'inventory.balances.read' } }, scope: 'BRANCH' },
          ],
        },
      },
    });
    branchRole = role.id;
    await prisma.userRole.create({
      data: { organizationId: org, userId: reader.id, roleId: role.id },
    });
    const auth = app.get(AuthService);
    const login = async (organizationCode: string, email = 'owner@example.test') =>
      (
        await auth.login(
          { organizationCode, email, password: 'synthetic-reconciliation-pass' },
          { requestId: 'reconciliation-fixture' },
        )
      ).accessToken;
    ownerToken = await login(code);
    foreignToken = await login(foreignCode);
    readerToken = await login(code, 'reader@example.test');
    const makeWarehouse = async (organizationId: string, code: string) => {
      const branch = await prisma.branch.create({ data: { organizationId, code, name: code } });
      return (
        await prisma.warehouse.create({
          data: { organizationId, branchId: branch.id, code, name: code },
        })
      ).id;
    };
    warehouse = await makeWarehouse(org, 'MAIN');
    emptyWarehouse = await makeWarehouse(org, 'EMPTY');
    foreignWarehouse = await makeWarehouse(other, 'FOREIGN');
    product = (await prisma.product.create({ data: { organizationId: org, name: 'Product' } })).id;
    const makeVariant = async (sku: string, quantityDelta: string) => {
      const variant = await prisma.productVariant.create({
        data: { organizationId: org, productId: product, sku, name: sku, sellingPrice: '1' },
      });
      await prisma.$transaction((tx) =>
        app.get(StockLedgerService).post(tx, {
          organizationId: org,
          warehouseId: warehouse,
          variantId: variant.id,
          createdBy: actor,
          referenceId: randomUUID(),
          referenceType: 'OPENING',
          quantityDelta,
        }),
      );
      return variant.id;
    };
    first = await makeVariant('RECON-A', '10.125');
    second = await makeVariant('RECON-B', '5');
    const reservation = await reservationFixture(prisma, {
      organizationId: org,
      warehouseId: warehouse,
      referenceId: randomUUID(),
      items: [{ variantId: first, quantity: '2.125' }],
    });
    await prisma.$transaction((tx) => app.get(ReservationsService).reserve(tx, reservation));
  });
  afterAll(async () => {
    if (prisma && org && other) {
      await cleanupInventory(prisma, [org, other]);
      await cleanupIam(prisma, [org, other]);
    }
    if (app) await app.close();
  });
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

  it('reports clean ledger and active reservations without writing any data', async () => {
    const response = await get().expect(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.meta).toMatchObject({
      page: 1,
      pageSize: 20,
      total: 0,
      requestId: expect.any(String),
    });
    expect((await reconciliation.check(org, { page: 1, pageSize: 100 })).items).toEqual([]);
    expect((await balance(first)).reserved.toFixed(3)).toBe('2.125');
    const result = cli(org);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).meta.total).toBe(0);
    expect(cli('invalid-org').status).toBe(1);
    expect(cli(randomUUID()).status).toBe(1);
  });
  it('finds both on-hand and reserved drift with exact strings and never repairs it', async () => {
    const row = await balance(first);
    await prisma.stockBalance.update({
      where: { id: row.id },
      data: { onHand: '9.124', reserved: '1.124' },
    });
    try {
      const response = await get().expect(200);
      expect(response.body.data).toEqual([
        expect.objectContaining({
          warehouseId: warehouse,
          variantId: first,
          sku: 'RECON-A',
          onHand: '9.124',
          expectedOnHand: '10.125',
          reserved: '1.124',
          expectedReserved: '2.125',
          missingBalance: false,
        }),
      ]);
      expect((await balance(first)).onHand.toFixed(3)).toBe('9.124');
      const result = cli(org);
      expect(result.status).toBe(2);
      expect(JSON.parse(result.stdout).meta.total).toBe(1);
      expect((await get('', foreignToken).expect(200)).body.data).toEqual([]);
    } finally {
      await prisma.stockBalance.update({
        where: { id: row.id },
        data: { onHand: '10.125', reserved: '2.125' },
      });
    }
  });
  it('also detects balances without ledger and ledger history with a missing balance', async () => {
    const row = await balance(second);
    const phantom = await prisma.productVariant.create({
      data: {
        organizationId: org,
        productId: product,
        sku: 'PHANTOM',
        name: 'Phantom',
        sellingPrice: '1',
      },
    });
    const extra = await prisma.stockBalance.create({
      data: { organizationId: org, warehouseId: warehouse, variantId: phantom.id, onHand: '4' },
    });
    await prisma.stockBalance.delete({ where: { id: row.id } });
    try {
      const response = await get().expect(200);
      expect(response.body.meta.total).toBe(2);
      expect(response.body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            variantId: phantom.id,
            onHand: '4.000',
            expectedOnHand: '0.000',
            missingBalance: false,
          }),
          expect.objectContaining({
            variantId: second,
            onHand: '0.000',
            expectedOnHand: '5.000',
            missingBalance: true,
          }),
        ]),
      );
      const page1 = await get('?pageSize=1&page=1').expect(200),
        page2 = await get('?pageSize=1&page=2').expect(200);
      expect(page1.body.meta.total).toBe(2);
      expect(page2.body.meta.total).toBe(2);
      expect(page1.body.data[0].variantId).not.toBe(page2.body.data[0].variantId);
      expect((await get('?pageSize=1&page=3').expect(200)).body.meta.total).toBe(2);
      expect((await get('?warehouseId=' + emptyWarehouse).expect(200)).body.meta.total).toBe(0);
    } finally {
      await prisma.stockBalance.create({ data: row });
      await prisma.stockBalance.delete({ where: { id: extra.id } });
    }
  });
  it('requires an ORG balance-read grant, scopes the warehouse and validates paging', async () => {
    await get('', '').expect(401);
    await get('', readerToken).expect(403);
    await get('?warehouseId=' + foreignWarehouse).expect(404);
    for (const query of [
      '?warehouseId=bad',
      '?page=0',
      '?pageSize=101',
      '?organizationId=' + other,
    ])
      await get(query).expect(400);
    await prisma.rolePermission.updateMany({
      where: { organizationId: org, roleId: branchRole },
      data: { scope: 'ORG' },
    });
    try {
      await get('', readerToken).expect(200);
    } finally {
      await prisma.rolePermission.updateMany({
        where: { organizationId: org, roleId: branchRole },
        data: { scope: 'BRANCH' },
      });
    }
  });
});
