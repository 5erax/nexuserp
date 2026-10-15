import createClient from 'openapi-fetch';
import type { paths } from './schema';
export function createApiClient(
  baseUrl: string,
  fetcher?: (request: Request) => Promise<Response>,
) {
  return createClient<paths>({ baseUrl, credentials: 'same-origin', fetch: fetcher });
}
export type { paths } from './schema';
export type { components } from './schema';
