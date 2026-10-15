import { z } from 'zod';
import { isIP } from 'node:net';
export const ENVIRONMENT = Symbol('ENVIRONMENT');
const schema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .refine((value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol)),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  JWT_SECRET: z.string().min(32).max(256),
  CSRF_SECRET: z.string().min(32).max(256),
  API_RATE_LIMIT: z.coerce.number().int().min(1).max(10000).default(300),
  TRUSTED_PROXY_IP: z
    .string()
    .refine((value) => isIP(value) !== 0)
    .optional(),
});
export type Environment = z.infer<typeof schema>;
export function parseEnvironment(input: Record<string, unknown>): Environment {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new Error(
      'Invalid environment: ' + result.error.issues.map((issue) => issue.path.join('.')).join(', '),
    );
  if (result.data.JWT_SECRET === result.data.CSRF_SECRET)
    throw new Error('Invalid environment: JWT_SECRET and CSRF_SECRET must differ');
  if (
    result.data.NODE_ENV === 'production' &&
    [result.data.JWT_SECRET, result.data.CSRF_SECRET].some((value) => value.startsWith('replace_'))
  )
    throw new Error(
      'Invalid environment: replace example JWT_SECRET and CSRF_SECRET before production',
    );
  const origin = new URL(result.data.WEB_ORIGIN);
  if (
    origin.origin !== result.data.WEB_ORIGIN ||
    (result.data.NODE_ENV === 'production' && origin.protocol !== 'https:')
  )
    throw new Error('Invalid environment: WEB_ORIGIN must be an exact origin, HTTPS in production');
  return result.data;
}
