import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Controller, Get, Post, Body, Module } from '@nestjs/common';
import { IsString } from 'class-validator';
import request from 'supertest';
import { configureApp } from '../src/configure-app';
import { parseEnvironment } from '../src/config/environment';
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
@Module({ controllers: [ProbeController] })
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
    const res = await request(app.getHttpServer()).get('/api/v1/probe/crash').expect(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('private-database-password');
  });
  it('gives unknown routes the error envelope', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/missing').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.requestId).toBeTruthy();
  });
});
describe('environment validation', () => {
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
