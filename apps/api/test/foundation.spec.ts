import { INestApplication, Logger } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { createOpenApi } from '../src/openapi';
import { Test } from '@nestjs/testing';
import { Controller, Get, Post, Body, Module } from '@nestjs/common';
import { IsString } from 'class-validator';
import request from 'supertest';
import { configureApp } from '../src/configure-app';
import { ENVIRONMENT, parseEnvironment } from '../src/config/environment';
import { RateLimiter } from '../src/common/security/rate-limiter';
class Input {
  @IsString() name!: string;
}
@Controller('probe')
class ProbeController {
  @Get() read() {
    return { status: 'ok' };
  }
  @Post() write(@Body() input: Input) {
    return input;
  }
  @Get('crash') crash() {
    throw new Error('private-database-password');
  }
}
@Module({
  controllers: [ProbeController],
  providers: [
    RateLimiter,
    {
      provide: ENVIRONMENT,
      useValue: { API_RATE_LIMIT: 300 },
    },
  ],
})
class ProbeModule {}
describe('API foundation contract', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  it('wraps data and keeps a safe request id in header and envelope', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/probe')
      .set('X-Request-Id', 'test-001')
      .expect(200);
    expect(res.body).toEqual({ data: { status: 'ok' }, meta: { requestId: 'test-001' } });
    expect(res.headers['x-request-id']).toBe('test-001');
  });
  it('rejects invalid and unknown input with a stable error code', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/probe')
      .send({ name: 123, secret: 'ignored?' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });
  it('does not expose internal exceptions', async () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const res = await request(app.getHttpServer()).get('/api/v1/probe/crash').expect(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('private-database-password');
    const diagnostic = log.mock.calls[0]?.[0];
    expect(diagnostic).toMatchObject({
      requestId: res.body.error.requestId,
      exceptionType: 'Error',
    });
    expect(diagnostic.stack).toContain('ProbeController.crash');
    expect(JSON.stringify(diagnostic)).not.toContain('private-database-password');
    log.mockRestore();
  });
  it('relaxes CSP only on development Swagger and keeps other security headers', async () => {
    const mod = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    const dev = mod.createNestApplication();
    configureApp(dev, true);
    SwaggerModule.setup('api/docs', dev, createOpenApi(dev));
    await dev.init();
    try {
      const docs = await request(dev.getHttpServer()).get('/api/docs').expect(200);
      expect(docs.headers['content-security-policy']).toBeUndefined();
      expect(docs.headers['x-content-type-options']).toBe('nosniff');
      const api = await request(dev.getHttpServer()).get('/api/v1/probe').expect(200);
      expect(api.headers['content-security-policy']).toContain("script-src 'self'");
      await request(app.getHttpServer()).get('/api/docs').expect(404);
    } finally {
      await dev.close();
    }
  });
  it('gives unknown routes the error envelope', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/missing').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.requestId).toBeTruthy();
  });
  it('correlates malformed and oversized JSON before parsing can fail', async () => {
    for (const [body, status] of [
      ['{"name":', 400],
      [JSON.stringify({ name: 'x'.repeat(1024 * 1024) }), 413],
    ] as const) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/probe')
        .set('Content-Type', 'application/json')
        .set('X-Request-Id', 'body-parser-test')
        .send(body)
        .expect(status);
      expect(response.headers['x-request-id']).toBe('body-parser-test');
      expect(response.body.error.requestId).toBe('body-parser-test');
      expect(response.body.error.code).toBe(
        status === 413 ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_ERROR',
      );
    }
    const spec = createOpenApi(app);
    expect(spec.components?.schemas?.ApiError).toHaveProperty(
      'properties.details.oneOf',
      expect.arrayContaining([expect.objectContaining({ type: 'array' })]),
    );
  });
});
describe('environment validation', () => {
  it('validates the exact nonnegative three-decimal approval threshold', () => {
    const base = {
      DATABASE_URL: 'postgresql://fixture:fixture@localhost/nexus_test',
      JWT_SECRET: 'j'.repeat(32),
      CSRF_SECRET: 'c'.repeat(32),
    };
    expect(parseEnvironment(base).INVENTORY_APPROVAL_THRESHOLD).toBe('10');
    for (const value of ['0', '0.001', '999999999999999.999'])
      expect(
        parseEnvironment({ ...base, INVENTORY_APPROVAL_THRESHOLD: value })
          .INVENTORY_APPROVAL_THRESHOLD,
      ).toBe(value);
    for (const value of ['-1', '1e3', '0.0001', '1000000000000000', '', 'NaN', 10])
      expect(() => parseEnvironment({ ...base, INVENTORY_APPROVAL_THRESHOLD: value })).toThrow(
        /INVENTORY_APPROVAL_THRESHOLD/,
      );
  });
  it('fails early when DATABASE_URL is missing', () =>
    expect(() => parseEnvironment({})).toThrow(/DATABASE_URL/));
  it('rejects non-postgres URLs and invalid ports', () =>
    expect(() => parseEnvironment({ DATABASE_URL: 'file:test', API_PORT: '70000' })).toThrow());
  it('does not leak the invalid database credential', () => {
    try {
      parseEnvironment({ DATABASE_URL: 'private-password' });
    } catch (error) {
      expect(String(error)).not.toContain('private-password');
    }
  });
});
