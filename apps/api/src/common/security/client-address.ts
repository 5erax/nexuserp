import { isIP } from 'node:net';
import { ServiceUnavailableException } from '@nestjs/common';
import type { Request } from 'express';
export function clientAddress(
  request: Pick<Request, 'socket' | 'headers'>,
  trustedProxyIp?: string,
) {
  const peer = request.socket.remoteAddress ?? 'unknown';
  if (!trustedProxyIp || !(peer === trustedProxyIp || peer === '::ffff:' + trustedProxyIp))
    return peer;
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded !== 'string' || !isIP(forwarded.trim()))
    throw new ServiceUnavailableException({
      code: 'PROXY_IDENTITY_INVALID',
      message: 'Dịch vụ chưa được cấu hình đúng',
    });
  return forwarded.trim();
}
