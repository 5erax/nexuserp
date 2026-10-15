import { createApiClient } from '@nexus/contracts';
import messages from '../../messages/vi.json';

let recovery: Promise<Response> | undefined;
function csrfCookie() {
  return document.cookie
    .split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith('nexus_csrf='))
    ?.slice(11);
}
async function send(original: Request) {
  const request = original.clone();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    if (!csrfCookie()) {
      const bootstrap = await fetch('/api/v1/auth/csrf', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
      if (!bootstrap.ok) return bootstrap;
    }
    const csrf = csrfCookie();
    if (csrf) request.headers.set('X-CSRF-Token', csrf);
  }
  return fetch(request, {
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(10000)]),
  });
}
export async function sessionFetch(request: Request): Promise<Response> {
  const response = await send(request);
  const path = new URL(request.url).pathname;
  if (
    response.status !== 401 ||
    ['/api/v1/auth/login', '/api/v1/auth/refresh', '/api/v1/auth/logout'].includes(path)
  )
    return response;
  if (recovery) {
    const outcome = await recovery;
    const retry = await send(request);
    return retry.status === 401 && outcome.status === 409 ? outcome.clone() : retry;
  }
  const recover = async () => {
    const result = await send(request);
    if (result.status !== 401) return result;
    const refreshed = await send(
      new Request(new URL('/api/v1/auth/refresh', request.url), { method: 'POST' }),
    );
    if (refreshed.status === 409) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      const retry = await send(request);
      return retry.status === 401 ? refreshed : retry;
    }
    return refreshed.ok ? send(request) : refreshed;
  };
  recovery = (async () => {
    if (navigator.locks) return await navigator.locks.request('nexuserp-session', recover);
    return recover();
  })().finally(() => {
    recovery = undefined;
  });
  return (await recovery).clone();
}
export const api = createApiClient('', sessionFetch);
export async function csrfParams() {
  if (!csrfCookie()) unwrap(await api.GET('/api/v1/auth/csrf'));
  const token = csrfCookie();
  if (!token) throw new ApiFailure(403, 'CSRF_INVALID', messages.errors.CSRF_INVALID);
  return { header: { 'X-CSRF-Token': token } };
}
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.data !== undefined && result.response.ok) return result.data;
  const body = result.error;
  const error = body && typeof body === 'object' && 'error' in body ? body.error : undefined;
  const fields = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const code = typeof fields.code === 'string' ? fields.code : 'UNKNOWN';
  const known = messages.errors as Record<string, string>;
  const message = known[code] ?? messages.auth.failed;
  const id =
    typeof fields.requestId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(fields.requestId)
      ? fields.requestId
      : undefined;
  const seconds = Number(result.response.headers.get('Retry-After'));
  throw new ApiFailure(
    result.response.status,
    code,
    message,
    id,
    seconds > 0 ? Math.min(seconds, 86400) : undefined,
  );
}
export function safeReturnPath(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value))
    return '/workspace';
  try {
    const url = new URL(value, 'https://local.invalid');
    if (
      url.origin !== 'https://local.invalid' ||
      ['/login', '/change-password'].includes(url.pathname)
    )
      return '/workspace';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/workspace';
  }
}
