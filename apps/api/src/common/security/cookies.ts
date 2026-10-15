import type { Request, Response, CookieOptions } from 'express';
export function cookie(request: Request, name: string): string | undefined {
  const values = (request.headers.cookie ?? '')
    .split(';')
    .map((v) => v.trim())
    .filter((v) => v.startsWith(name + '='));
  if (values.length !== 1) return;
  const value = values[0]!.slice(name.length + 1);
  return value.length <= 4096 && /^[A-Za-z0-9._-]+$/.test(value) ? value : undefined;
}
export function cookieOptions(secure: boolean, path: string, httpOnly = true): CookieOptions {
  return { httpOnly, secure, sameSite: 'lax', path };
}
export function clearSession(response: Response, secure: boolean) {
  for (const [name, path, httpOnly] of [
    ['nexus_access', '/api/v1', true],
    ['nexus_refresh', '/api/v1/auth', true],
    ['nexus_csrf', '/', false],
    ['nexus_preauth', '/api/v1/auth', true],
  ] as const)
    response.clearCookie(name, cookieOptions(secure, path, httpOnly));
}
