import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { OrganizationRepository } from '../src/modules/iam/infrastructure/organization.repository';
import { configureApp } from '../src/configure-app';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { ENVIRONMENT, parseEnvironment } from '../src/config/environment';
describe('PostgreSQL baseline', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repository: OrganizationRepository;
  const ids: string[] = [];
  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL)
      throw new Error(
        'TEST_DATABASE_URL required; integration tests never default to the app database',
      );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    repository = app.get(OrganizationRepository);
  });
  afterAll(async () => {
    if (prisma) {
      await prisma.branch.deleteMany({ where: { organizationId: { in: ids } } });
      await prisma.organization.deleteMany({ where: { id: { in: ids } } });
    }
    if (app) await app.close();
  });
  it('creates and reads an organization through its owning repository', async () => {
    const code = 'T-' + randomUUID().slice(0, 8);
    const org = await repository.create({ code, name: 'Integration organization' });
    ids.push(org.id);
    expect((await repository.findById(org.id))?.currency).toBe('VND');
  });
  it('rejects duplicate branch code within an organization and invalid status', async () => {
    const org = await repository.create({
      code: 'T-' + randomUUID().slice(0, 8),
      name: 'Constraints',
    });
    ids.push(org.id);
    await prisma.branch.create({ data: { organizationId: org.id, code: 'MAIN', name: 'Main' } });
    await expect(
      prisma.branch.create({ data: { organizationId: org.id, code: 'MAIN', name: 'Duplicate' } }),
    ).rejects.toThrow();
    await expect(
      prisma.branch.create({
        data: { organizationId: org.id, code: 'BAD', name: 'Bad', status: 'UNKNOWN' },
      }),
    ).rejects.toThrow();
  });
  it('reports ready only when PostgreSQL is reachable', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    expect(res.body.data.status).toBe('ready');
  });
  it('keeps liveness available and hides connection details when PostgreSQL is down', async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENVIRONMENT)
      .useValue(
        parseEnvironment({
          ...process.env,
          DATABASE_URL: 'postgresql://unused:private-value@127.0.0.1:1/nexuserp_test',
        }),
      )
      .compile();
    const unavailable = module.createNestApplication();
    try {
      configureApp(unavailable);
      await unavailable.init();
      await request(unavailable.getHttpServer()).get('/api/v1/health').expect(200);
      const result = await request(unavailable.getHttpServer())
        .get('/api/v1/health/ready')
        .expect(503);
      expect(result.body.error.code).toBe('DATABASE_UNAVAILABLE');
      expect(JSON.stringify(result.body)).not.toContain('private-value');
    } finally {
      await unavailable.close();
    }
  });
});
