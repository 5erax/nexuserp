import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { createOpenApi } from '../src/openapi';
import { ENVIRONMENT, parseEnvironment, type Environment } from '../src/config/environment';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { PasswordService } from '../src/modules/iam/application/password.service';
import { AuthService } from '../src/modules/iam/application/auth.service';
import { CsrfService } from '../src/common/security/csrf.service';
import { AuditService } from '../src/modules/audit/application/audit.service';
import { seedIam } from '../src/modules/iam/infrastructure/seed-permissions';
import { cleanupIam } from './fixtures/cleanup-iam';
describe('IAM users API', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let config: Environment;
  let auth: AuthService;
  let csrf: CsrfService;
  const organizationId = randomUUID(),
    foreignOrganizationId = randomUUID(),
    branchA = randomUUID(),
    branchB = randomUUID();
  const organizationCode = 'T-' + organizationId.slice(0, 8).toUpperCase();
  const password = 'fixture-password-strong';
  const ids = {
    owner1: randomUUID(),
    owner2: randomUUID(),
    manager: randomUUID(),
    salesA: randomUUID(),
    salesB: randomUUID(),
    shared: randomUUID(),
    limited: randomUUID(),
    foreign: randomUUID(),
  };
  const roles = new Map<string, string>();
  type Session = Awaited<ReturnType<AuthService['login']>> & { csrfToken: string };
  const email = (id: string) => id + '@example.test';
  async function login(id: string): Promise<Session> {
    const value = await auth.login(
      { organizationCode, email: email(id), password },
      { requestId: 'users-fixture' },
    );
    return { ...value, csrfToken: csrf.issue('family:' + value.familyId) };
  }
  const api = (method: 'get' | 'post' | 'patch' | 'put', path: string, session: Session) => {
    const server = request(app.getHttpServer());
    return server[method]('/api/v1' + path)
      .set('Origin', config.WEB_ORIGIN)
      .set('X-CSRF-Token', session.csrfToken)
      .set(
        'Cookie',
        `nexus_access=${session.accessToken}; nexus_refresh=${session.refreshToken}; nexus_csrf=${session.csrfToken}`,
      );
  };
  beforeAll(async () => {
    config = parseEnvironment({
      ...process.env,
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      NODE_ENV: 'test',
    });
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENVIRONMENT)
      .useValue(config)
      .compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    auth = app.get(AuthService);
    csrf = app.get(CsrfService);
    await prisma.organization.create({
      data: { id: organizationId, code: organizationCode, name: 'Users fixture' },
    });
    await prisma.organization.create({
      data: {
        id: foreignOrganizationId,
        code: 'T-' + foreignOrganizationId.slice(0, 8).toUpperCase(),
        name: 'Foreign fixture',
      },
    });
    await prisma.$transaction((tx) => seedIam(tx, organizationId));
    await prisma.$transaction((tx) => seedIam(tx, foreignOrganizationId));
    for (const role of await prisma.role.findMany({ where: { organizationId } }))
      roles.set(role.code, role.id);
    await prisma.branch.createMany({
      data: [
        { id: branchA, organizationId, code: 'A', name: 'Branch A' },
        { id: branchB, organizationId, code: 'B', name: 'Branch B' },
      ],
    });
    const passwordHash = await app.get(PasswordService).hash(password);
    for (const [name, id] of Object.entries(ids)) {
      const org = name === 'foreign' ? foreignOrganizationId : organizationId;
      await prisma.user.create({
        data: { id, organizationId: org, email: email(id), displayName: name, passwordHash },
      });
      if (name === 'foreign') continue;
      const code = name.startsWith('owner')
        ? 'BUSINESS_OWNER'
        : name === 'manager'
          ? 'BRANCH_MANAGER'
          : 'SALES_STAFF';
      if (name !== 'limited')
        await prisma.userRole.create({
          data: { organizationId, userId: id, roleId: roles.get(code)! },
        });
      const branches =
        name === 'shared'
          ? [branchA, branchB]
          : name === 'salesB'
            ? [branchB]
            : name === 'manager' || name === 'salesA'
              ? [branchA]
              : [];
      await prisma.userBranchAccess.createMany({
        data: branches.map((branchId) => ({ organizationId, userId: id, branchId })),
      });
    }
    const limited = await prisma.role.create({
      data: { organizationId, code: 'LIMITED', name: 'Limited' },
    });
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { code: 'iam.users.manage' },
    });
    await prisma.rolePermission.create({
      data: { organizationId, roleId: limited.id, permissionId: permission.id, scope: 'ORG' },
    });
    const rolesManage = await prisma.permission.findUniqueOrThrow({
      where: { code: 'iam.roles.manage' },
    });
    await prisma.rolePermission.create({
      data: { organizationId, roleId: limited.id, permissionId: rolesManage.id, scope: 'ORG' },
    });
    await prisma.userRole.create({
      data: { organizationId, userId: ids.limited, roleId: limited.id },
    });
  });
  afterAll(async () => {
    if (prisma) await cleanupIam(prisma, [organizationId, foreignOrganizationId]);
    if (app) await app.close();
  });
  it('publishes integer pagination for all administration list contracts', () => {
    const spec = createOpenApi(app);
    for (const path of ['/api/v1/users', '/api/v1/branches', '/api/v1/roles']) {
      expect(spec.paths[path]?.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'page',
            schema: expect.objectContaining({ type: 'integer' }),
          }),
          expect.objectContaining({
            name: 'pageSize',
            schema: expect.objectContaining({ type: 'integer' }),
          }),
        ]),
      );
    }
    expect(spec.paths['/api/v1/audit-logs']?.get?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'limit',
          schema: expect.objectContaining({ type: 'integer' }),
        }),
      ]),
    );
    for (const path of Object.values(spec.paths))
      for (const method of ['post', 'patch', 'put', 'delete'] as const)
        if (path?.[method])
          expect(path[method]!.parameters).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ in: 'header', name: 'X-CSRF-Token', required: true }),
            ]),
          );
  });
  it('IAM-004 filters users and totals before pagination, hides other memberships and rejects IDOR', async () => {
    const manager = await login(ids.manager);
    const list = await api('get', '/users?pageSize=100', manager).expect(200);
    expect(list.body.meta.total).toBe(3);
    expect(list.body.data.map((u: { id: string }) => u.id).sort()).toEqual(
      [ids.manager, ids.salesA, ids.shared].sort(),
    );
    expect(list.body.data.find((u: { id: string }) => u.id === ids.shared).branchIds).toEqual([
      branchA,
    ]);
    expect(
      (await api('get', '/users?branchId=' + branchB, manager).expect(200)).body.meta.total,
    ).toBe(0);
    // Filtering by B must not reveal that a visible A user also belongs to B.
    expect((await api('get', '/users?q=salesB', manager).expect(200)).body.meta.total).toBe(0);
    await api('get', '/users/' + ids.salesB, manager).expect(404);
    await api('patch', '/users/' + ids.salesA, manager)
      .send({ displayName: 'Denied' })
      .expect(403);
    const owner = await login(ids.owner1);
    await api('get', '/users/' + ids.foreign, owner).expect(404);
    await api('patch', '/users/' + ids.foreign, owner)
      .send({ displayName: 'Denied' })
      .expect(404);
  });
  it('IAM-001 creates a scoped account, rejects duplicates, nulls and mass assignment', async () => {
    const owner = await login(ids.owner1);
    const input = {
      email: 'new-' + randomUUID() + '@example.test',
      displayName: 'New sales',
      temporaryPassword: 'temporary-password-strong',
      roleIds: [roles.get('SALES_STAFF')!],
      branchIds: [branchA],
    };
    const created = await api('post', '/users', owner).send(input).expect(201);
    expect(created.body.data.mustChangePassword).toBe(true);
    expect(JSON.stringify(created.body)).not.toMatch(/passwordHash|temporaryPassword/);
    await api('post', '/users', owner)
      .send({ ...input, email: input.email.toUpperCase() })
      .expect(409);
    await api('patch', '/users/' + created.body.data.id, owner)
      .send({ status: null })
      .expect(400);
    await api('patch', '/users/' + created.body.data.id, owner)
      .send({ passwordHash: 'plaintext', organizationId: foreignOrganizationId })
      .expect(400);
    const foreignRole = await prisma.role.findFirstOrThrow({
      where: { organizationId: foreignOrganizationId },
    });
    await api('post', '/users', owner)
      .send({ ...input, email: 'other-' + input.email, roleIds: [foreignRole.id] })
      .expect(400);
    await api('post', '/users', owner)
      .send({ ...input, email: 'none-' + input.email, branchIds: [] })
      .expect(400);
  });
  it('IAM-003 prevents delegation or mutation above the actor grants', async () => {
    const limited = await login(ids.limited);
    await api('post', '/users', limited)
      .send({
        email: 'escalate@example.test',
        displayName: 'Escalate',
        temporaryPassword: 'temporary-password-strong',
        roleIds: [roles.get('BUSINESS_OWNER')!],
        branchIds: [],
      })
      .expect(403);
    await api('patch', '/users/' + ids.owner1, limited)
      .send({ temporaryPassword: 'replacement-password-strong' })
      .expect(403);
  });
  it('IAM-003 permits updates to users with overlapping grants from multiple roles', async () => {
    const owner = await login(ids.owner1);
    await api('patch', '/users/' + ids.shared, owner)
      .send({ roleIds: [roles.get('SALES_STAFF')!, roles.get('WAREHOUSE_STAFF')!] })
      .expect(200);
    await api('patch', '/users/' + ids.shared, owner)
      .send({ displayName: 'Shared staff' })
      .expect(200);
  });
  it('IAM-005 audit failure rolls back the user change', async () => {
    const owner = await login(ids.owner1);
    const record = jest
      .spyOn(app.get(AuditService), 'record')
      .mockRejectedValueOnce(new Error('Injected audit failure'));
    await api('patch', '/users/' + ids.salesA, owner)
      .send({ displayName: 'Must rollback' })
      .expect(500);
    record.mockRestore();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.salesA } })).displayName).toBe(
      'salesA',
    );
    const response = await api('patch', '/users/' + ids.salesA, owner)
      .set('X-Request-Id', 'users-mutation-test')
      .send({ displayName: 'Updated sales' })
      .expect(200);
    expect(
      await prisma.auditLog.count({
        where: {
          entityId: ids.salesA,
          requestId: response.body.meta.requestId,
          action: 'iam.user_updated',
        },
      }),
    ).toBe(1);
  });
  it('IAM-006 concurrent self-disable leaves one admin and cannot remove the last role', async () => {
    const [one, two] = await Promise.all([login(ids.owner1), login(ids.owner2)]);
    const responses = await Promise.all([
      api('patch', '/users/' + ids.owner1, one).send({ status: 'INACTIVE' }),
      api('patch', '/users/' + ids.owner2, two).send({ status: 'INACTIVE' }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const active = await prisma.user.findMany({
      where: { id: { in: [ids.owner1, ids.owner2] }, status: 'ACTIVE' },
    });
    expect(active).toHaveLength(1);
    const current = await login(active[0]!.id);
    const denied = await api('patch', '/users/' + active[0]!.id, current)
      .send({ roleIds: [] })
      .expect(409);
    expect(denied.body.error.code).toBe('LAST_ADMIN_REQUIRED');
    await prisma.user.updateMany({
      where: { id: { in: [ids.owner1, ids.owner2] } },
      data: { status: 'ACTIVE' },
    });
  });
  it('IAM-002/007 disabling and password reset revoke every session immediately', async () => {
    const owner = await login(ids.owner1);
    const staff = await login(ids.salesA);
    await api('patch', '/users/' + ids.salesA, owner)
      .send({ status: 'INACTIVE' })
      .expect(200);
    await api('get', '/auth/me', staff).expect(401);
    expect(
      await prisma.refreshFamily.count({ where: { userId: ids.salesA, revokedAt: null } }),
    ).toBe(0);
    await api('patch', '/users/' + ids.salesA, owner)
      .send({ status: 'ACTIVE', temporaryPassword: 'temporary-reset-password' })
      .expect(200);
    const logged = await auth.login(
      { organizationCode, email: email(ids.salesA), password: 'temporary-reset-password' },
      { requestId: 'reset-test' },
    );
    expect((await auth.actor(logged.accessToken)).mustChangePassword).toBe(true);
  });
  it('IAM-007 admin disable and email/password reset serialize with refresh without deadlocks', async () => {
    const owner = await login(ids.owner1);
    for (const change of [
      { status: 'INACTIVE' },
      { email: 'changed-' + email(ids.salesB), temporaryPassword: 'reset-after-race-password' },
    ]) {
      const staff = await login(ids.salesB);
      let pending: Promise<request.Response[]> | undefined;
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM refresh_families WHERE id=${staff.familyId}::uuid FOR UPDATE`;
        pending = Promise.all([
          api('post', '/auth/refresh', staff).then((r) => r),
          api('patch', '/users/' + ids.salesB, owner)
            .send(change)
            .then((r) => r),
        ]);
        let waiters = 0;
        for (let attempt = 0; attempt < 100; attempt++) {
          await tx.$queryRaw`SELECT pg_stat_clear_snapshot()::text`;
          const rows = await tx.$queryRaw<
            { count: number }[]
          >`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%refresh_families%' AND pid<>pg_backend_pid()`;
          waiters = rows[0]!.count;
          if (waiters >= 2) break;
          await tx.$queryRaw`SELECT pg_sleep(0.01)::text`;
        }
        expect(waiters).toBeGreaterThanOrEqual(2);
      });
      const responses = await pending!;
      expect([200, 401]).toContain(responses[0]!.status);
      expect(responses[1]!.status).toBe(200);
      await api('get', '/auth/me', staff).expect(401);
      expect(
        await prisma.refreshFamily.count({ where: { userId: ids.salesB, revokedAt: null } }),
      ).toBe(0);
      await api('patch', '/users/' + ids.salesB, owner)
        .send({ status: 'ACTIVE', email: email(ids.salesB), temporaryPassword: password })
        .expect(200);
    }
  });
  it('IAM-003 custom role updates apply next request and cannot alter system roles or elevate grants', async () => {
    const owner = await login(ids.owner1);
    const limited = await login(ids.limited);
    const permissionList = await api('get', '/permissions', owner).expect(200);
    expect(permissionList.body.data).toHaveLength(35);
    await api('post', '/roles', owner)
      .send({
        code: 'DUPLICATE',
        name: 'Duplicate',
        permissions: [
          { code: 'iam.users.read', scope: 'ORG' },
          { code: 'iam.users.read', scope: 'BRANCH' },
        ],
      })
      .expect(400);
    const created = await api('post', '/roles', owner)
      .send({
        code: 'CUSTOM_READ',
        name: 'Read users',
        permissions: [{ code: 'iam.users.read', scope: 'ORG' }],
      })
      .expect(201);
    const limitedRole = await prisma.role.findUniqueOrThrow({
      where: { organizationId_code: { organizationId, code: 'LIMITED' } },
    });
    await api('patch', '/users/' + ids.limited, owner)
      .send({ roleIds: [limitedRole.id, created.body.data.id] })
      .expect(200);
    expect(
      (await api('get', '/auth/me', limited).expect(200)).body.data.grants['iam.users.read'],
    ).toEqual(['ORG']);
    await api('put', '/roles/' + created.body.data.id + '/permissions', owner)
      .send({ permissions: [] })
      .expect(200);
    expect(
      (await api('get', '/auth/me', limited).expect(200)).body.data.grants['iam.users.read'],
    ).toBeUndefined();
    await api('put', '/roles/' + roles.get('BUSINESS_OWNER') + '/permissions', owner)
      .send({ permissions: [] })
      .expect(409);
    await api('post', '/roles', limited)
      .send({
        code: 'ESCALATE',
        name: 'Escalate',
        permissions: [{ code: 'catalog.products.manage', scope: 'ORG' }],
      })
      .expect(403);
    await api('post', '/roles', owner)
      .send({
        code: 'UNKNOWN',
        name: 'Invalid',
        permissions: [{ code: 'constructor', scope: 'ORG' }],
      })
      .expect(400);
    const foreignRole = await prisma.role.findFirstOrThrow({
      where: { organizationId: foreignOrganizationId },
    });
    await api('put', '/roles/' + foreignRole.id + '/permissions', owner)
      .send({ permissions: [] })
      .expect(404);
    expect(
      await prisma.role.count({ where: { organizationId, code: { in: ['ESCALATE', 'UNKNOWN'] } } }),
    ).toBe(0);
  });
  it('IAM-004 branches are scoped and deactivation cannot orphan active branch staff', async () => {
    const owner = await login(ids.owner1),
      manager = await login(ids.manager);
    expect(
      (await api('get', '/branches', manager).expect(200)).body.data.map(
        (b: { id: string }) => b.id,
      ),
    ).toEqual([branchA]);
    await api('get', '/branches/' + branchB, manager).expect(404);
    const created = await api('post', '/branches', owner)
      .send({ code: 'C', name: 'Branch C' })
      .expect(201);
    await api('post', '/branches', owner).send({ code: 'c', name: 'Duplicate' }).expect(409);
    expect(
      (
        await api('patch', '/branches/' + branchA, owner)
          .send({ status: 'INACTIVE' })
          .expect(409)
      ).body.error.code,
    ).toBe('BRANCH_HAS_ACTIVE_USERS');
    await api('patch', '/branches/' + created.body.data.id, owner)
      .send({ status: 'INACTIVE' })
      .expect(200);
    const foreign = await prisma.branch.create({
      data: { organizationId: foreignOrganizationId, code: 'FOREIGN', name: 'Foreign' },
    });
    await api('get', '/branches/' + foreign.id, owner).expect(404);
    await api('patch', '/branches/' + foreign.id, owner)
      .send({ name: 'Denied' })
      .expect(404);
    await api('get', '/organization', manager).expect(403);
    const profile = await api('patch', '/organization', owner)
      .send({ name: 'Updated fixture', currency: 'VND', timezone: 'Asia/Ho_Chi_Minh' })
      .expect(200);
    expect(profile.body.data.code).toBe(organizationCode);
    await api('patch', '/organization', owner).send({ currency: 'USD' }).expect(400);
    await api('patch', '/organization', owner).send({ timezone: 'Mars/Base' }).expect(400);
  });
  it('IAM-005 audit query enforces branch scope, redaction and stable cursor pagination', async () => {
    const owner = await login(ids.owner1),
      manager = await login(ids.manager);
    const audit = app.get(AuditService);
    for (const branchId of [branchA, branchB])
      await prisma.$transaction((tx) =>
        audit.record(tx, {
          organizationId,
          branchId,
          actorId: ids.owner1,
          action: 'test.audit',
          entityType: 'test',
          requestId: 'audit-scope',
          changes: { passwordHash: 'private-value', label: branchId },
        }),
      );
    const scoped = await api('get', '/audit-logs?entityType=test', manager).expect(200);
    expect(scoped.body.data).toHaveLength(1);
    expect(scoped.body.data[0].branchId).toBe(branchA);
    expect(JSON.stringify(scoped.body)).not.toContain('private-value');
    expect(
      (await api('get', '/audit-logs?entityType=test&branchId=' + branchB, manager).expect(200))
        .body.data,
    ).toEqual([]);
    const first = await api('get', '/audit-logs?entityType=test&limit=1', owner).expect(200);
    expect(first.body.meta.nextCursor).toBeTruthy();
    const second = await api(
      'get',
      '/audit-logs?entityType=test&limit=1&cursor=' + first.body.meta.nextCursor,
      owner,
    ).expect(200);
    expect(second.body.data[0].id).not.toBe(first.body.data[0].id);
    expect(second.body.meta.nextCursor).toBeNull();
    await api('get', '/audit-logs?cursor=invalid', owner).expect(400);
    await api('get', '/audit-logs?from=2026-12-01&to=2026-01-01', owner).expect(400);
    await api('get', '/audit-logs', await login(ids.salesB)).expect(403);
  });
});
