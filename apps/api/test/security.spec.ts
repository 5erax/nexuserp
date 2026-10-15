import { randomBytes } from 'node:crypto';
import { CsrfService } from '../src/common/security/csrf.service';
import { RateLimiter } from '../src/common/security/rate-limiter';
import { cookie, cookieOptions } from '../src/common/security/cookies';
import { PasswordService } from '../src/modules/iam/application/password.service';
import { scopeFilter, canGrant, type Actor } from '../src/modules/iam/domain/access-scope';
import { parseEnvironment } from '../src/config/environment';
import type { Request, Response } from 'express';
const config = () =>
  parseEnvironment({
    DATABASE_URL: 'postgresql://test:test@127.0.0.1/unit_test',
    JWT_SECRET: randomBytes(32).toString('hex'),
    CSRF_SECRET: randomBytes(32).toString('hex'),
  });
describe('auth trust boundaries', () => {
  it('IAM-007 binds signed double-submit tokens to one family', () => {
    const csrf = new CsrfService(config());
    const token = csrf.issue('family:A');
    expect(csrf.issue('family:A', token)).toBe(token);
    expect(() => csrf.verify('family:A', token, token)).not.toThrow();
    expect(() => csrf.verify('family:B', token, token)).toThrow();
    expect(() => csrf.verify('family:A', token + 'a', token)).toThrow();
    expect(csrf.preauthBinding(Date.now() - 600001 + '.' + 'a'.repeat(64))).toBeUndefined();
  });
  it('rejects duplicate or malformed cookies and preserves production flags', () => {
    expect(
      cookie({ headers: { cookie: 'nexus_access=a; nexus_access=b' } } as Request, 'nexus_access'),
    ).toBeUndefined();
    expect(cookieOptions(true, '/api/v1/auth')).toEqual({
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      path: '/api/v1/auth',
    });
  });
  it('limits brute force and returns Retry-After', () => {
    const limiter = new RateLimiter();
    const setHeader = jest.fn();
    const response = { setHeader } as unknown as Response;
    limiter.take('one', 2, 60000, response);
    limiter.take('one', 2, 60000, response);
    expect(() => limiter.take('one', 2, 60000, response)).toThrow();
    expect(setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
  });
  it('IAM-003/004 denies missing scope and keeps ownership inside permitted branches', () => {
    const actor: Actor = {
      id: 'U',
      organizationId: 'O',
      familyId: 'F',
      email: 'test@example.test',
      displayName: 'Test',
      mustChangePassword: false,
      roles: [],
      branchIds: ['A'],
      grants: { 'sales.orders.read': ['OWN'] },
    };
    expect(scopeFilter(actor, 'sales.orders.read')).toEqual({
      organizationId: 'O',
      branchId: { in: ['A'] },
      createdBy: 'U',
    });
    expect(scopeFilter(actor, 'sales.orders.update')).toEqual({
      organizationId: 'O',
      branchId: { in: [] },
    });
    expect(canGrant(actor, 'sales.orders.read', 'BRANCH')).toBe(false);
  });
  it('hashes and verifies Argon2id with an independent salt and recognizes weaker policy', async () => {
    const passwords = new PasswordService();
    await passwords.onModuleInit();
    const encoded = await passwords.hash('correct-horse-battery');
    expect(encoded).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await passwords.hash('correct-horse-battery')).not.toBe(encoded);
    expect(await passwords.verify('correct-horse-battery', encoded)).toBe(true);
    expect(await passwords.verify('incorrect', encoded)).toBe(false);
    expect(await passwords.verify('incorrect')).toBe(false);
    expect(passwords.needsRehash(encoded)).toBe(false);
    expect(passwords.needsRehash(encoded.replace('m=19456', 'm=8192'))).toBe(true);
  });
});
