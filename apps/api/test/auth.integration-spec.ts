import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Controller, Get, Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ModulesContainer } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { METHOD_METADATA } from '@nestjs/common/constants';
import request, { type Response as TestResponse } from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { ENVIRONMENT, parseEnvironment, type Environment } from '../src/config/environment';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService, tokenHash } from '../src/modules/iam/application/auth.service';
import { PasswordService } from '../src/modules/iam/application/password.service';
import { CsrfService } from '../src/common/security/csrf.service';
import { ACCESS, RequirePermission } from '../src/common/security/access';
import { AuditService } from '../src/modules/audit/application/audit.service';
import { seedIam } from '../src/modules/iam/infrastructure/seed-permissions';
import { cleanupIam } from './fixtures/cleanup-iam';
import { pruneExpiredSessions } from '../src/modules/iam/infrastructure/prune-sessions';
@Controller('security-probe')
class ProbeController {
  @Get() @RequirePermission('iam.users.manage') admin() {
    return { ok: true };
  }
  @Get('unclassified') unclassified() {
    return { ok: true };
  }
}
@Module({ imports: [AppModule], controllers: [ProbeController] })
class SecurityTestModule {}
type Session = Awaited<ReturnType<AuthService['login']>> & { csrfToken: string };
describe('IAM auth security on PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;
  let csrf: CsrfService;
  let config: Environment;
  const organizationId = randomUUID();
  const organizationCode = 'T-' + organizationId.slice(0, 8).toUpperCase();
  const userId = randomUUID();
  const email = 'owner@example.test';
  const password = 'correct-horse-battery';
  const cookies = (session: Session) =>
    `nexus_access=${session.accessToken}; nexus_refresh=${session.refreshToken}; nexus_csrf=${session.csrfToken}`;
  const context = { requestId: 'security-test' };
  async function session(): Promise<Session> {
    const value = await auth.login({ organizationCode, email, password }, context);
    return { ...value, csrfToken: csrf.issue('family:' + value.familyId) };
  }
  const mutate = (path: string, value: Session) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/' + path)
      .set('Origin', config.WEB_ORIGIN)
      .set('Cookie', cookies(value))
      .set('X-CSRF-Token', value.csrfToken);
  const extract = (response: TestResponse) => {
    const values = response.headers['set-cookie'] as unknown as string[];
    const jar = Object.fromEntries(values.map((v) => v.split(';')[0]!.split('=')));
    return {
      accessToken: jar.nexus_access!,
      refreshToken: jar.nexus_refresh!,
      csrfToken: jar.nexus_csrf!,
    };
  };
  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL required');
    config = parseEnvironment({
      ...process.env,
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      NODE_ENV: 'test',
    });
    const mod = await Test.createTestingModule({ imports: [SecurityTestModule] })
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
      data: { id: organizationId, code: organizationCode, name: 'Security fixture' },
    });
    await prisma.$transaction((tx) => seedIam(tx, organizationId));
    await prisma.user.create({
      data: {
        id: userId,
        organizationId,
        email,
        displayName: 'Owner',
        passwordHash: await app.get(PasswordService).hash(password),
      },
    });
    const role = await prisma.role.findUniqueOrThrow({
      where: { organizationId_code: { organizationId, code: 'BUSINESS_OWNER' } },
    });
    await prisma.userRole.create({ data: { organizationId, userId, roleId: role.id } });
  });
  afterAll(async () => {
    if (prisma) await cleanupIam(prisma, [organizationId]);
    if (app) await app.close();
  });
  it('IAM-003 every application route declares an access policy', () => {
    const missing: string[] = [];
    for (const mod of app.get(ModulesContainer).values())
      for (const wrapper of mod.controllers.values()) {
        const controller = wrapper.metatype;
        if (!controller || controller === ProbeController) continue;
        for (const name of Object.getOwnPropertyNames(controller.prototype)) {
          const handler = Object.getOwnPropertyDescriptor(controller.prototype, name)?.value;
          if (
            typeof handler === 'function' &&
            Reflect.hasMetadata(METHOD_METADATA, handler) &&
            !Reflect.hasMetadata(ACCESS, handler) &&
            !Reflect.hasMetadata(ACCESS, controller)
          )
            missing.push(controller.name + '.' + name);
        }
      }
    expect(missing).toEqual([]);
    expect(Reflect.hasMetadata(ACCESS, ProbeController.prototype.unclassified)).toBe(false);
  });
  it('IAM-001/002 logs in via bootstrap with safe cookies, profile and no token in JSON', async () => {
    const bootstrap = await request(app.getHttpServer()).get('/api/v1/auth/csrf').expect(200);
    const preCookies = (bootstrap.headers['set-cookie'] as unknown as string[])
      .map((v) => v.split(';')[0])
      .join('; ');
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', config.WEB_ORIGIN)
      .set('Cookie', preCookies)
      .set('X-CSRF-Token', bootstrap.body.data.csrfToken)
      .send({ organizationCode, email: email.toUpperCase(), password })
      .expect(200);
    expect(login.body.data).toEqual({ authenticated: true });
    expect(JSON.stringify(login.body)).not.toContain('Token');
    const flags = (login.headers['set-cookie'] as unknown as string[]).find((v) =>
      v.startsWith('nexus_refresh='),
    );
    expect(flags).toContain('Path=/api/v1/auth');
    expect(flags).toContain('HttpOnly');
    expect(flags).toContain('SameSite=Lax');
    expect(flags).not.toContain('Secure');
    const tokens = extract(login);
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', `nexus_access=${tokens.accessToken}`)
      .expect(200);
    expect(me.body.data.email).toBe(email);
    expect(me.body.data.grants['iam.users.manage']).toContain('ORG');
    expect(JSON.stringify(me.body)).not.toMatch(/passwordHash|refreshToken|accessToken/);
    expect(login.headers['cache-control']).toBe('no-store');
  });
  it('IAM-002 uses identical errors for nonexistent, wrong-password and inactive accounts', async () => {
    const input = { organizationCode, email, password: 'incorrect-password' };
    const errors = [];
    for (const candidate of [input, { ...input, email: 'missing@example.test' }]) {
      try {
        await auth.login(candidate, context);
      } catch (error) {
        errors.push((error as { getResponse: () => unknown }).getResponse());
      }
    }
    await prisma.user.update({ where: { id: userId }, data: { status: 'INACTIVE' } });
    try {
      await auth.login({ ...input, password }, context);
    } catch (error) {
      errors.push((error as { getResponse: () => unknown }).getResponse());
    }
    await prisma.user.update({ where: { id: userId }, data: { status: 'ACTIVE' } });
    expect(errors).toHaveLength(3);
    expect(errors[0]).toEqual(errors[1]);
    expect(errors[1]).toEqual(errors[2]);
  });
  it('rejects missing CSRF and foreign or missing Origin before rotating', async () => {
    const value = await session();
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookies(value))
      .set('Origin', config.WEB_ORIGIN)
      .expect(403);
    await mutate('refresh', value).set('Origin', 'https://evil.example').expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookies(value))
      .set('X-CSRF-Token', value.csrfToken)
      .expect(403);
    expect(
      (
        await prisma.refreshSession.findUniqueOrThrow({
          where: { tokenHash: tokenHash(value.refreshToken) },
        })
      ).rotatedAt,
    ).toBeNull();
  });
  it('IAM-003 denies unclassified routes even to owner and missing permissions to a member', async () => {
    const value = await session();
    await request(app.getHttpServer())
      .get('/api/v1/security-probe/unclassified')
      .set('Cookie', cookies(value))
      .expect(403);
    await request(app.getHttpServer()).get('/api/v1/security-probe').expect(401);
    const assignments = await prisma.userRole.findMany({ where: { userId } });
    await prisma.userRole.deleteMany({ where: { userId } });
    await request(app.getHttpServer())
      .get('/api/v1/security-probe')
      .set('Cookie', cookies(value))
      .expect(403);
    await prisma.userRole.createMany({ data: assignments });
  });
  async function concurrent(
    value: Session,
    paths: string[],
    passwordInput?: { currentPassword: string; newPassword: string },
  ) {
    let pending: Promise<TestResponse[]> | undefined;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM refresh_families WHERE id=${value.familyId}::uuid FOR UPDATE`;
      pending = Promise.all(
        paths.map((path) =>
          mutate(path, value)
            .send(path === 'password' ? passwordInput : undefined)
            .then((response) => response),
        ),
      );
      let waiters = 0;
      for (let attempt = 0; attempt < 80; attempt++) {
        await tx.$queryRaw`SELECT pg_stat_clear_snapshot()::text`;
        const rows = await tx.$queryRaw<
          { count: number }[]
        >`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%refresh_families%' AND pid<>pg_backend_pid()`;
        waiters = rows[0]!.count;
        if (waiters >= paths.length) break;
        await tx.$queryRaw`SELECT pg_sleep(0.01)::text`;
      }
      expect(waiters).toBeGreaterThanOrEqual(paths.length);
    });
    return pending!;
  }
  it('IAM-007 two overlapping refresh requests create one successor and a cookie-free 409', async () => {
    const value = await session();
    const responses = await concurrent(value, ['refresh', 'refresh']);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(responses.find((r) => r.status === 409)!.headers['set-cookie']).toBeUndefined();
    expect(await prisma.refreshSession.count({ where: { familyId: value.familyId } })).toBe(2);
    expect(
      (await prisma.refreshFamily.findUniqueOrThrow({ where: { id: value.familyId } })).revokedAt,
    ).toBeNull();
    const next = extract(responses.find((r) => r.status === 200)!);
    expect(next.csrfToken).toBe(value.csrfToken);
  });
  it('IAM-007 respects 4.999s/5.000s boundary and commits revoke before 401', async () => {
    const value = await session();
    await mutate('refresh', value).expect(200);
    const original = await prisma.refreshSession.findUniqueOrThrow({
      where: { tokenHash: tokenHash(value.refreshToken) },
    });
    const now = jest
      .spyOn(auth, 'now')
      .mockResolvedValue(new Date(original.rotatedAt!.getTime() + 4999));
    const conflict = await mutate('refresh', value).expect(409);
    expect(conflict.headers['set-cookie']).toBeUndefined();
    now.mockResolvedValue(new Date(original.rotatedAt!.getTime() + 5000));
    const replay = await mutate('refresh', value).expect(401);
    now.mockRestore();
    expect(replay.body.error.code).toBe('REFRESH_REUSE_DETECTED');
    expect(
      (await prisma.refreshFamily.findUniqueOrThrow({ where: { id: value.familyId } })).revokedAt,
    ).not.toBeNull();
    expect(
      await prisma.auditLog.count({
        where: { entityId: value.familyId, action: 'auth.refresh_reuse' },
      }),
    ).toBe(1);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', cookies(value))
      .expect(401);
  });
  it('IAM-007 reusing T0 after T1 rotates revokes the family even inside the grace window', async () => {
    const value = await session();
    const one = extract(await mutate('refresh', value).expect(200));
    await mutate('refresh', { ...value, ...one }).expect(200);
    expect((await mutate('refresh', value).expect(401)).body.error.code).toBe(
      'REFRESH_REUSE_DETECTED',
    );
  });
  it('IAM-007 audit failure before commit leaves the old token current', async () => {
    const value = await session();
    const audit = app.get(AuditService);
    const record = jest
      .spyOn(audit, 'record')
      .mockRejectedValueOnce(new Error('Injected audit failure'));
    await mutate('refresh', value).expect(500);
    record.mockRestore();
    expect(
      (
        await prisma.refreshSession.findUniqueOrThrow({
          where: { tokenHash: tokenHash(value.refreshToken) },
        })
      ).rotatedAt,
    ).toBeNull();
    await mutate('refresh', value).expect(200);
  });
  it('IAM-007 logout races safely with rotation and does not revoke another device', async () => {
    const value = await session();
    const other = await session();
    const responses = await concurrent(value, ['refresh', 'logout']);
    expect(responses[1]!.status).toBe(200);
    expect(
      (await prisma.refreshFamily.findUniqueOrThrow({ where: { id: value.familyId } })).revokedAt,
    ).not.toBeNull();
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', cookies(value))
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', cookies(other))
      .expect(200);
    await mutate('logout', value).expect(200);
  });
  it('IAM-002 inactive users immediately lose both access and refresh', async () => {
    const value = await session();
    await prisma.user.update({ where: { id: userId }, data: { status: 'LOCKED' } });
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', cookies(value))
      .expect(401);
    expect((await mutate('refresh', value).expect(401)).body.error.code).toBe('SESSION_INVALID');
    await prisma.user.update({ where: { id: userId }, data: { status: 'ACTIVE' } });
  });
  it('refresh works with an expired access JWT without extending the family deadline', async () => {
    const value = await session();
    const accessToken = await new JwtService().signAsync(
      { sub: userId, organizationId, familyId: value.familyId },
      {
        secret: config.JWT_SECRET,
        algorithm: 'HS256',
        issuer: 'nexuserp',
        audience: 'nexuserp-web',
        expiresIn: -1,
      },
    );
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', cookies({ ...value, accessToken }))
      .expect(401);
    const refreshed = extract(await mutate('refresh', { ...value, accessToken }).expect(200));
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', `nexus_access=${refreshed.accessToken}`)
      .expect(200);
    const row = await prisma.refreshSession.findUniqueOrThrow({
      where: { tokenHash: tokenHash(refreshed.refreshToken) },
    });
    expect(row.expiresAt).toEqual(value.expiresAt);
  });
  it('expired family bootstrap gives a usable ten-minute pre-auth cookie', async () => {
    const value = await session();
    await mutate('refresh', value).expect(200);
    await prisma.refreshFamily.update({
      where: { id: value.familyId },
      data: {
        createdAt: new Date(Date.now() - 8 * 86400000),
        expiresAt: new Date(Date.now() - 86400000),
      },
    });
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/csrf')
      .set('Cookie', cookies(value))
      .expect(200);
    const flags = (response.headers['set-cookie'] as unknown as string[]).find((v) =>
      v.startsWith('nexus_csrf='),
    );
    expect(flags).toContain('Max-Age=600');
    expect(response.body.data.csrfToken).not.toBe(value.csrfToken);
    const preCookies = (response.headers['set-cookie'] as unknown as string[])
      .map((v) => v.split(';')[0])
      .join('; ');
    const invalid = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', config.WEB_ORIGIN)
      .set('Cookie', `nexus_refresh=${value.refreshToken}; ${preCookies}`)
      .set('X-CSRF-Token', response.body.data.csrfToken)
      .expect(401);
    expect(invalid.body.error.code).toBe('SESSION_INVALID');
    expect(invalid.headers['set-cookie']).toBeDefined();
    const active = await session();
    await mutate('refresh', active).expect(200);
    const candidate = await prisma.refreshFamily.findUniqueOrThrow({
      where: { id: value.familyId },
    });
    const candidates = jest
      .spyOn(prisma.refreshFamily, 'findMany')
      .mockResolvedValueOnce([candidate]);
    expect(await pruneExpiredSessions(prisma)).toBe(1);
    candidates.mockRestore();
    expect(await prisma.refreshFamily.findUnique({ where: { id: value.familyId } })).toBeNull();
    expect(await prisma.refreshSession.count({ where: { familyId: active.familyId } })).toBe(2);
    expect(
      await prisma.auditLog.count({ where: { entityId: value.familyId, action: 'auth.login' } }),
    ).toBe(1);
  });
  it('returns invalid refresh and idempotent logout when pruning removes a hinted family', async () => {
    for (const route of ['refresh', 'logout']) {
      const value = await session();
      await prisma.refreshFamily.update({
        where: { id: value.familyId },
        data: {
          createdAt: new Date(Date.now() - 172800000),
          expiresAt: new Date(Date.now() - 86400000),
        },
      });
      const original = auth.refreshBinding.bind(auth);
      const binding = jest
        .spyOn(auth, 'refreshBinding')
        .mockImplementationOnce(original)
        .mockImplementationOnce(async (token) => {
          const hint = await original(token);
          await prisma.$transaction(async (tx) => {
            await tx.refreshSession.deleteMany({ where: { familyId: value.familyId } });
            await tx.refreshFamily.delete({ where: { id: value.familyId } });
          });
          return hint;
        });
      try {
        const response = await mutate(route, value).expect(route === 'refresh' ? 401 : 200);
        if (route === 'refresh') expect(response.body.error.code).toBe('SESSION_INVALID');
        else expect(response.body.data.authenticated).toBe(false);
      } finally {
        binding.mockRestore();
      }
    }
  });
  it('counts malformed and oversized bodies before parsing and limits equivalent CSRF routes', async () => {
    for (const apiLimit of [3, 300]) {
      const mod = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(ENVIRONMENT)
        .useValue({ ...config, API_RATE_LIMIT: apiLimit })
        .compile();
      const isolated = mod.createNestApplication();
      configureApp(isolated);
      await isolated.init();
      try {
        if (apiLimit === 3) {
          for (const body of ['{', JSON.stringify({ padding: 'x'.repeat(1024 * 1024) }), '{'])
            await request(isolated.getHttpServer())
              .post('/api/v1/auth/login')
              .set('Content-Type', 'application/json')
              .send(body)
              .expect(body === '{' ? 400 : 413);
          const blocked = await request(isolated.getHttpServer())
            .post('/api/v1/auth/login')
            .set('Content-Type', 'application/json')
            .send('{')
            .expect(429);
          expect(blocked.body.error.code).toBe('RATE_LIMITED');
          expect(blocked.body.error.requestId).toBeTruthy();
        } else {
          for (let i = 0; i < 60; i++)
            await request(isolated.getHttpServer())
              .get(i % 2 ? '/api/v1/auth/csrf/' : '/api/v1/auth/csrf')
              .expect(200);
          await request(isolated.getHttpServer()).get('/api/v1/auth/csrf/').expect(429);
        }
      } finally {
        await isolated.close();
      }
    }
  });
  it('enforces production Secure flags and API login limits with Retry-After', async () => {
    const production = {
      ...config,
      NODE_ENV: 'production' as const,
      WEB_ORIGIN: 'https://example.test',
    };
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENVIRONMENT)
      .useValue(production)
      .compile();
    const isolated = mod.createNestApplication();
    configureApp(isolated);
    await isolated.init();
    try {
      const bootstrap = await request(isolated.getHttpServer())
        .get('/api/v1/auth/csrf')
        .expect(200);
      const preCookies = (bootstrap.headers['set-cookie'] as unknown as string[])
        .map((v) => v.split(';')[0])
        .join('; ');
      for (let attempt = 0; attempt < 12; attempt++)
        await request(isolated.getHttpServer())
          .post('/api/v1/auth/login')
          .set('Origin', 'https://evil.example')
          .send({ organizationCode, email, password })
          .expect(403);
      const login = await request(isolated.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', production.WEB_ORIGIN)
        .set('Cookie', preCookies)
        .set('X-CSRF-Token', bootstrap.body.data.csrfToken)
        .send({ organizationCode, email, password })
        .expect(200);
      expect(
        (login.headers['set-cookie'] as unknown as string[])
          .filter((v) => v.startsWith('nexus_access=') || v.startsWith('nexus_refresh='))
          .every((v) => v.includes('Secure') && v.includes('HttpOnly') && !v.includes('Domain=')),
      ).toBe(true);
      for (let attempt = 0; attempt < 9; attempt++)
        await request(isolated.getHttpServer())
          .post('/api/v1/auth/login')
          .set('Origin', production.WEB_ORIGIN)
          .set('Cookie', preCookies)
          .set('X-CSRF-Token', bootstrap.body.data.csrfToken)
          .send({ organizationCode, email, password: 'incorrect' })
          .expect(401);
      const blocked = await request(isolated.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', production.WEB_ORIGIN)
        .set('Cookie', preCookies)
        .set('X-CSRF-Token', bootstrap.body.data.csrfToken)
        .send({ organizationCode, email, password })
        .expect(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    } finally {
      await isolated.close();
    }
  });
  it('IAM-007 password change wins against concurrent refresh and revokes every device', async () => {
    const value = await session();
    const other = await session();
    await mutate('password', value)
      .send({ currentPassword: 'incorrect', newPassword: 'new-correct-horse-battery' })
      .expect(401);
    await prisma.user.update({ where: { id: userId }, data: { mustChangePassword: true } });
    await request(app.getHttpServer())
      .get('/api/v1/security-probe')
      .set('Cookie', cookies(value))
      .expect(403);
    const responses = await concurrent(value, ['refresh', 'password'], {
      currentPassword: password,
      newPassword: 'new-correct-horse-battery',
    });
    expect(responses[1]!.status).toBe(200);
    expect([200, 401]).toContain(responses[0]!.status);
    for (const candidate of [value, other])
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', cookies(candidate))
        .expect(401);
    expect(await prisma.refreshFamily.count({ where: { userId, revokedAt: null } })).toBe(0);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).mustChangePassword,
    ).toBe(false);
    const next = await auth.login(
      { organizationCode, email, password: 'new-correct-horse-battery' },
      context,
    );
    expect(next.familyId).toBeTruthy();
  });
});
