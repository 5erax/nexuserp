import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  ForbiddenException,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsString, MinLength } from 'class-validator';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { ENVIRONMENT, parseEnvironment } from '../src/config/environment';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { Prisma } from '../src/generated/prisma/client';
import { createOpenApi } from '../src/openapi';
import { Idempotent } from '../src/common/idempotency/idempotent';
import { IdempotentCommand } from '../src/common/idempotency/command';
import {
  IdempotencyService,
  pruneExpiredKeys,
} from '../src/common/idempotency/idempotency.service';
import { RequirePermission } from '../src/common/security/access';
import { CsrfService } from '../src/common/security/csrf.service';
import type { AuthorizedRequest } from '../src/common/security/security.guard';
import { AuthService } from '../src/modules/iam/application/auth.service';
import { PasswordService } from '../src/modules/iam/application/password.service';
import { seedIam } from '../src/modules/iam/infrastructure/seed-permissions';
import { cleanupIam } from './fixtures/cleanup-iam';

class CommandInput {
  @IsString() @MinLength(1) name!: string;
}
@Controller('idempotency-probe')
class ProbeController {
  @Post(':id')
  @RequirePermission('iam.users.manage')
  @Idempotent()
  resource(
    @Req() req: AuthorizedRequest,
    @Body() input: CommandInput,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.create(req, { name: `${input.name} (${id.toLowerCase()})` });
  }
  @Post()
  @RequirePermission('iam.users.manage')
  @Idempotent()
  create(@Req() req: AuthorizedRequest, @Body() input: CommandInput) {
    return new IdempotentCommand(
      input,
      async (tx) => {
        const actor = await tx.user.findUniqueOrThrow({ where: { id: req.actor.id } });
        if (actor.displayName === 'Scope removed') throw new ForbiddenException();
      },
      async (tx) => {
        const row = await tx.branch.create({
          data: {
            organizationId: req.actor.organizationId,
            code: randomUUID().slice(0, 32),
            name: input.name,
          },
        });
        return { id: row.id, name: row.name };
      },
    );
  }
}
@Module({
  imports: [AppModule],
  controllers: [ProbeController],
})
class CommandTestModule {}

describe('Idempotent commands on PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: IdempotencyService;
  const organizationId = randomUUID(),
    otherOrganizationId = randomUUID(),
    userId = randomUUID(),
    otherUser = randomUUID();
  const organizationCode = 'T-' + organizationId.slice(0, 8).toUpperCase();
  const config = parseEnvironment({
    ...process.env,
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    NODE_ENV: 'test',
  });
  let session: Awaited<ReturnType<AuthService['login']>>;
  let csrfToken: string;
  const identity = (key = randomUUID()) => ({
    organizationId,
    actorId: userId,
    command: 'POST /probe {}',
    version: 'v1',
    key,
  });
  const plan = (input: unknown = { name: 'Created' }) =>
    new IdempotentCommand(
      input,
      async (tx) => {
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        if (user.displayName === 'Scope removed') throw new ForbiddenException();
      },
      async (tx) => {
        const row = await tx.branch.create({
          data: { organizationId, code: randomUUID().slice(0, 32), name: 'Created once' },
        });
        return { id: row.id, amount: '9007199254740993', optional: null };
      },
    );
  const post = (key?: string) => {
    const req = request(app.getHttpServer())
      .post('/api/v1/idempotency-probe')
      .set('Origin', config.WEB_ORIGIN)
      .set('Cookie', `nexus_access=${session.accessToken}; nexus_csrf=${csrfToken}`)
      .set('X-CSRF-Token', csrfToken);
    return key ? req.set('Idempotency-Key', key) : req;
  };
  beforeAll(async () => {
    if (
      !process.env.TEST_DATABASE_URL ||
      !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')
    )
      throw new Error('Explicit _test database required');
    const mod = await Test.createTestingModule({ imports: [CommandTestModule] })
      .overrideProvider(ENVIRONMENT)
      .useValue(config)
      .compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(IdempotencyService);
    await prisma.organization.create({
      data: { id: organizationId, code: organizationCode, name: 'Command fixture' },
    });
    await prisma.organization.create({
      data: {
        id: otherOrganizationId,
        code: 'T-' + otherOrganizationId.slice(0, 8),
        name: 'Foreign command fixture',
      },
    });
    await prisma.$transaction((tx) => seedIam(tx, organizationId));
    const passwordHash = await app.get(PasswordService).hash('synthetic-command-password');
    await prisma.user.createMany({
      data: [userId, otherUser].map((id) => ({
        id,
        organizationId,
        email: `${id}@example.test`,
        displayName: 'Owner',
        passwordHash,
      })),
    });
    const owner = await prisma.role.findUniqueOrThrow({
      where: { organizationId_code: { organizationId, code: 'BUSINESS_OWNER' } },
    });
    await prisma.userRole.create({ data: { organizationId, userId, roleId: owner.id } });
    session = await app.get(AuthService).login(
      {
        organizationCode,
        email: `${userId}@example.test`,
        password: 'synthetic-command-password',
      },
      { requestId: 'command-test' },
    );
    csrfToken = app.get(CsrfService).issue('family:' + session.familyId);
  });
  afterAll(async () => {
    if (prisma) await cleanupIam(prisma, [organizationId, otherOrganizationId]);
    if (app) await app.close();
  });

  it('returns the stored status and data for canonical-equivalent validated input', async () => {
    const key = identity();
    const before = await prisma.branch.count({ where: { organizationId } });
    const first = await service.execute(key, plan({ name: 'A', nested: { z: 1, a: 2 } }), 201);
    const again = await service.execute(key, plan({ nested: { a: 2, z: 1 }, name: 'A' }), 200);
    expect(first.replayed).toBe(false);
    expect(again).toEqual({ ...first, replayed: true });
    expect(await prisma.branch.count({ where: { organizationId } })).toBe(before + 1);
  });
  it('rejects changed payload, array order and command version without executing again', async () => {
    const key = identity();
    await service.execute(key, plan({ items: ['a', 'b'] }));
    for (const [context, input] of [
      [key, { items: ['b', 'a'] }],
      [key, { items: ['a', 'b'], extra: true }],
      [{ ...key, version: 'v2' }, { items: ['a', 'b'] }],
    ] as const)
      await expect(service.execute(context, plan(input))).rejects.toMatchObject({
        response: { code: 'IDEMPOTENCY_KEY_REUSED' },
      });
  });
  it('scopes a key by actor and command/resource identity', async () => {
    const key = identity();
    const first = await service.execute(key, plan());
    const anotherActor = await service.execute({ ...key, actorId: otherUser }, plan());
    const anotherResource = await service.execute(
      { ...key, command: 'POST /probe/:id {"id":"different"}' },
      plan(),
    );
    expect(new Set([first.data.id, anotherActor.data.id, anotherResource.data.id]).size).toBe(3);
  });
  it('executes once with ten concurrent requests and returns conflicts or committed replays', async () => {
    const key = identity();
    const before = await prisma.branch.count({ where: { organizationId } });
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => service.execute(key, plan())),
    );
    const successful = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    expect(successful.filter((r) => !r.replayed)).toHaveLength(1);
    expect(new Set(successful.map((r) => r.data.id)).size).toBe(1);
    for (const result of results)
      if (result.status === 'rejected')
        expect(result.reason).toMatchObject({ response: { code: 'REQUEST_IN_PROGRESS' } });
    expect(await prisma.branch.count({ where: { organizationId } })).toBe(before + 1);
  });
  it('rolls the key and business write back together, leaving a retry possible', async () => {
    const key = identity();
    const before = await prisma.branch.count({ where: { organizationId } });
    const base = plan();
    const broken = new IdempotentCommand(base.input, base.authorize, async (tx) => {
      await base.run(tx);
      throw new Error('synthetic-rollback');
    });
    await expect(service.execute(key, broken)).rejects.toThrow('synthetic-rollback');
    expect(await prisma.idempotencyKey.count({ where: { organizationId, key: key.key } })).toBe(0);
    expect(await prisma.branch.count({ where: { organizationId } })).toBe(before);
    expect((await service.execute(key, plan())).replayed).toBe(false);
  });
  it('checks current resource scope before replaying a stored response', async () => {
    const key = identity();
    await service.execute(key, plan());
    await prisma.user.update({ where: { id: userId }, data: { displayName: 'Scope removed' } });
    try {
      await expect(service.execute(key, plan())).rejects.toBeInstanceOf(ForbiddenException);
    } finally {
      await prisma.user.update({ where: { id: userId }, data: { displayName: 'Owner' } });
    }
  });
  it('rejects secret-bearing responses and rolls their writes back', async () => {
    const key = identity();
    const before = await prisma.branch.count({ where: { organizationId } });
    const unsafe = plan();
    const run = unsafe.run;
    const command = new IdempotentCommand({}, unsafe.authorize, async (tx) => {
      await run(tx);
      return { nested: [{ refreshToken: 'do-not-cache' }] };
    });
    await expect(service.execute(key, command)).rejects.toThrow();
    expect(await prisma.idempotencyKey.count({ where: { organizationId, key: key.key } })).toBe(0);
    expect(await prisma.branch.count({ where: { organizationId } })).toBe(before);
  });
  it('expires a key after 24 hours and prunes only a bounded batch', async () => {
    if (
      await prisma.idempotencyKey.count({
        where: { organizationId: { not: organizationId }, expiresAt: { lte: new Date() } },
      })
    )
      throw new Error('Pruning test needs an isolated database without foreign expired keys');
    const key = identity();
    await service.execute(key, plan());
    const row = await prisma.idempotencyKey.findFirstOrThrow({
      where: { organizationId, key: key.key },
    });
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(86400000);
    await prisma.idempotencyKey.update({
      where: { id: row.id },
      data: {
        createdAt: new Date(Date.now() - 172800000),
        expiresAt: new Date(Date.now() - 86400000),
      },
    });
    const [retried] = await Promise.all([
      service.execute(key, plan({ differentAfterExpiry: true })),
      pruneExpiredKeys(prisma, 1),
    ]);
    expect(retried.replayed).toBe(false);
    const expired = {
      organizationId,
      actorId: userId,
      command: 'POST /expired',
      requestHash: 'a'.repeat(64),
      createdAt: new Date(Date.now() - 172800000),
      expiresAt: new Date(Date.now() - 86400000),
    };
    await prisma.idempotencyKey.createMany({
      data: Array.from({ length: 3 }, () => ({ ...expired, key: randomUUID() })),
    });
    expect(await pruneExpiredKeys(prisma, 2)).toBe(2);
    expect(
      await prisma.idempotencyKey.count({ where: { organizationId, command: expired.command } }),
    ).toBe(1);
    await prisma.idempotencyKey.deleteMany({ where: { organizationId, command: expired.command } });
  });
  it('keeps the pruning limit when PostgreSQL chooses a nested-loop plan', async () => {
    const command = 'POST /pruning-plan-fixture';
    await prisma.idempotencyKey.createMany({
      data: Array.from({ length: 12 }, () => ({
        organizationId,
        actorId: userId,
        command,
        key: randomUUID(),
        requestHash: 'a'.repeat(64),
        createdAt: new Date(Date.now() - 172800000),
        expiresAt: new Date(Date.now() - 86400000),
      })),
    });
    const removed = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL enable_hashjoin = off`;
      await tx.$executeRaw`SET LOCAL enable_mergejoin = off`;
      await tx.$executeRaw`SET LOCAL enable_material = off`;
      return pruneExpiredKeys(tx, 2);
    });
    expect(removed).toBe(2);
    expect(await prisma.idempotencyKey.count({ where: { organizationId, command } })).toBe(10);
    await prisma.idempotencyKey.deleteMany({ where: { organizationId, command } });
  });
  it('requires a valid UUID header and validates DTOs before claiming a key', async () => {
    await post().send({ name: 'A' }).expect(400);
    await post('invalid').send({ name: 'A' }).expect(400);
    const key = randomUUID();
    await post(key).send({ name: '' }).expect(400);
    expect(await prisma.idempotencyKey.count({ where: { organizationId, key } })).toBe(0);
    const first = await post(key)
      .set('X-Request-Id', 'command-first')
      .send({ name: 'Created over HTTP' })
      .expect(201);
    const replay = await post(key)
      .set('X-Request-Id', 'command-replay')
      .send({ name: 'Created over HTTP' })
      .expect(201);
    expect(replay.body.data).toEqual(first.body.data);
    expect(replay.body.meta.requestId).toBe('command-replay');
    expect(first.headers['idempotency-replayed']).toBe('false');
    expect(replay.headers['idempotency-replayed']).toBe('true');
  });
  it('checks permissions and CSRF again before a replay', async () => {
    const key = randomUUID();
    await post(key).send({ name: 'Scoped' }).expect(201);
    await post(key).set('X-CSRF-Token', 'invalid').send({ name: 'Scoped' }).expect(403);
    await prisma.userRole.deleteMany({ where: { organizationId, userId } });
    try {
      await post(key).send({ name: 'Scoped' }).expect(403);
    } finally {
      const owner = await prisma.role.findUniqueOrThrow({
        where: { organizationId_code: { organizationId, code: 'BUSINESS_OWNER' } },
      });
      await prisma.userRole.create({ data: { organizationId, userId, roleId: owner.id } });
    }
  });
  it('scopes the HTTP command by route and validated resource ID', async () => {
    const key = randomUUID();
    const firstResource = 'abcdef12' + randomUUID().slice(8),
      secondResource = randomUUID();
    const resourcePost = (id: string) =>
      request(app.getHttpServer())
        .post('/api/v1/idempotency-probe/' + id)
        .set('Origin', config.WEB_ORIGIN)
        .set('Cookie', `nexus_access=${session.accessToken}; nexus_csrf=${csrfToken}`)
        .set('X-CSRF-Token', csrfToken)
        .set('Idempotency-Key', key)
        .send({ name: 'Resource command' });
    await resourcePost('invalid').expect(400);
    const first = await resourcePost(firstResource).expect(201);
    const second = await resourcePost(secondResource).expect(201);
    const replay = await resourcePost(firstResource).expect(201);
    expect(first.body.data.id).not.toBe(second.body.data.id);
    expect(replay.body.data).toEqual(first.body.data);
    const uppercaseReplay = await resourcePost(firstResource.toUpperCase()).expect(201);
    expect(uppercaseReplay.body.data).toEqual(first.body.data);
    expect(uppercaseReplay.headers['idempotency-replayed']).toBe('true');
  });
  it('returns Retry-After for an incomplete key and documents the required UUID header', async () => {
    const key = randomUUID();
    await post(key).send({ name: 'Incomplete' }).expect(201);
    const row = await prisma.idempotencyKey.findFirstOrThrow({ where: { organizationId, key } });
    await prisma.idempotencyKey.update({
      where: { id: row.id },
      data: { status: 'IN_PROGRESS', response: Prisma.DbNull, responseStatus: null },
    });
    const conflict = await post(key).send({ name: 'Incomplete' }).expect(409);
    expect(conflict.body.error.code).toBe('REQUEST_IN_PROGRESS');
    expect(conflict.headers['retry-after']).toBe('1');
    const operation = createOpenApi(app).paths['/api/v1/idempotency-probe']!.post!;
    expect(operation.parameters).toContainEqual(
      expect.objectContaining({ in: 'header', name: 'Idempotency-Key', required: true }),
    );
  });
  it('rejects malformed state, expiry, hashes and foreign actor references in PostgreSQL', async () => {
    const input = {
      organizationId,
      actorId: userId,
      command: 'POST /constraints',
      key: randomUUID(),
      requestHash: 'a'.repeat(64),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    };
    for (const data of [
      { ...input, expiresAt: input.createdAt },
      { ...input, requestHash: 'invalid' },
      { ...input, status: 'UNKNOWN' },
      { ...input, status: 'COMPLETED', response: { ok: true } },
      { ...input, status: 'COMPLETED', response: { ok: true }, responseStatus: 500 },
      { ...input, organizationId: otherOrganizationId },
    ])
      await expect(prisma.idempotencyKey.create({ data })).rejects.toThrow();
  });
  it('never replays a response after the session is revoked', async () => {
    const key = randomUUID();
    await post(key).send({ name: 'Before revocation' }).expect(201);
    await prisma.refreshFamily.update({
      where: { id: session.familyId },
      data: { revokedAt: new Date() },
    });
    await post(key).send({ name: 'Before revocation' }).expect(401);
  });
});
