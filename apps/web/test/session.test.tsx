import { afterEach, beforeEach, expect, it, vi } from 'vitest';
let sessionFetch: typeof import('../lib/auth/api').sessionFetch;
let safeReturnPath: typeof import('../lib/auth/api').safeReturnPath;
beforeEach(async () => {
  vi.resetModules();
  document.cookie = 'nexus_csrf=signed-test; Path=/';
  ({ sessionFetch, safeReturnPath } = await import('../lib/auth/api'));
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'nexus_csrf=; Max-Age=0; Path=/';
});
const response = (
  status: number,
  data: unknown = status === 401 ? { error: { code: 'SESSION_INVALID' } } : {},
) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const req = (path = '/users') => new Request('http://localhost/api/v1' + path);
it('does not refresh or repeat a password change rejected for invalid current credentials', async () => {
  const fetcher = vi.fn(async () => response(401, { error: { code: 'INVALID_CREDENTIALS' } }));
  vi.stubGlobal('fetch', fetcher);
  expect((await sessionFetch(new Request(req('/auth/password'), { method: 'POST' }))).status).toBe(
    401,
  );
  expect(fetcher).toHaveBeenCalledOnce();
});
it('waits for in-flight recovery before logout clears the session', async () => {
  vi.stubGlobal('navigator', {});
  const events: string[] = [];
  let active = false,
    finish!: () => void,
    started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  const fetcher = vi.fn(async (input: Request) => {
    if (input.url.endsWith('/auth/refresh')) {
      started();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      active = true;
      events.push('refresh-response');
      return response(200);
    }
    if (input.url.endsWith('/auth/logout')) {
      events.push('logout');
      active = false;
      return response(200);
    }
    return response(active ? 200 : 401);
  });
  vi.stubGlobal('fetch', fetcher);
  const pending = sessionFetch(req());
  await waiting;
  const logout = sessionFetch(new Request(req('/auth/logout'), { method: 'POST' }));
  await Promise.resolve();
  expect(events).toEqual([]);
  finish();
  await Promise.all([pending, logout]);
  expect(events).toEqual(['refresh-response', 'logout']);
});
it('sends current CSRF and never refreshes an incorrect login', async () => {
  const fetcher = vi.fn(async (input: Request) => {
    expect(input.headers.get('X-CSRF-Token')).toBe('signed-test');
    return response(401);
  });
  vi.stubGlobal('fetch', fetcher);
  expect(
    (await sessionFetch(new Request(req('/auth/login'), { method: 'POST', body: '{}' }))).status,
  ).toBe(401);
  expect(fetcher).toHaveBeenCalledOnce();
});
it('single-flights concurrent 401s, retries under Web Lock and returns each original response', async () => {
  let active = false;
  const lock = vi.fn(async (_name: string, callback: () => Promise<void>) => callback());
  vi.stubGlobal('navigator', { locks: { request: lock } });
  const fetcher = vi.fn(async (input: Request) => {
    if (input.url.endsWith('/auth/refresh')) {
      active = true;
      return response(200);
    }
    return response(active ? 200 : 401, {
      path: new URL(input.url).pathname,
      ...(!active ? { error: { code: 'SESSION_INVALID' } } : {}),
    });
  });
  vi.stubGlobal('fetch', fetcher);
  const [users, branches] = await Promise.all([
    sessionFetch(req()),
    sessionFetch(req('/branches')),
  ]);
  expect(users.status).toBe(200);
  expect(branches.status).toBe(200);
  expect((await users.json()).path).toBe('/api/v1/users');
  expect((await branches.json()).path).toBe('/api/v1/branches');
  expect(fetcher.mock.calls.filter(([r]) => r.url.endsWith('/auth/refresh'))).toHaveLength(1);
  expect(lock).toHaveBeenCalledOnce();
});
it('rechecks the original request after another tab wins, without a second refresh', async () => {
  let active = false;
  vi.stubGlobal('navigator', {
    locks: {
      request: async (_name: string, callback: () => Promise<Response>) => {
        active = true;
        return callback();
      },
    },
  });
  const fetcher = vi.fn(async () => response(active ? 200 : 401));
  vi.stubGlobal('fetch', fetcher);
  expect((await sessionFetch(req())).status).toBe(200);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('preserves 409 and cookies when the winning response is not available yet', async () => {
  vi.stubGlobal('navigator', {});
  const fetcher = vi.fn(async (input: Request) =>
    response(input.url.endsWith('/auth/refresh') ? 409 : 401),
  );
  vi.stubGlobal('fetch', fetcher);
  const results = await Promise.all([sessionFetch(req()), sessionFetch(req('/branches'))]);
  expect(results.map((r) => r.status)).toEqual([409, 409]);
  expect(document.cookie).toContain('nexus_csrf=signed-test');
  expect(fetcher.mock.calls.filter(([r]) => r.url.endsWith('/auth/refresh'))).toHaveLength(1);
});
it('does not retry refresh when its response is lost', async () => {
  vi.stubGlobal('navigator', {});
  const fetcher = vi.fn(async (input: Request) => {
    if (input.url.endsWith('/auth/refresh')) throw new TypeError('network');
    return response(401);
  });
  vi.stubGlobal('fetch', fetcher);
  await expect(sessionFetch(req())).rejects.toThrow('network');
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it('bootstraps missing CSRF and propagates 429 without sending the mutation', async () => {
  document.cookie = 'nexus_csrf=; Max-Age=0; Path=/';
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    expect(input).toBe('/api/v1/auth/csrf');
    return response(429);
  });
  vi.stubGlobal('fetch', fetcher);
  expect((await sessionFetch(new Request(req('/auth/login'), { method: 'POST' }))).status).toBe(
    429,
  );
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/auth/csrf');
});
it('only accepts internal return destinations', () => {
  for (const value of [null, 'https://evil.test', '//evil.test', '/\\evil.test', '/login'])
    expect(safeReturnPath(value)).toBe('/workspace');
  expect(safeReturnPath('/admin/users?page=2')).toBe('/admin/users?page=2');
  expect(safeReturnPath('/change-password')).toBe('/change-password');
});
