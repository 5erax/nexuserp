import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { ENVIRONMENT, type Environment } from '../../config/environment';
@Injectable()
export class CsrfService {
  constructor(@Inject(ENVIRONMENT) private readonly config: Environment) {}
  private sign(binding: string, nonce: string) {
    return createHmac('sha256', this.config.CSRF_SECRET)
      .update(binding + '|' + nonce)
      .digest('hex');
  }
  valid(binding: string, token: string | undefined) {
    if (!token || !/^[0-9a-f]{64}\.[0-9a-f]{64}$/.test(token)) return false;
    const [nonce, signature] = token.split('.');
    return timingSafeEqual(
      Buffer.from(signature!, 'hex'),
      Buffer.from(this.sign(binding, nonce!), 'hex'),
    );
  }
  issue(binding: string, existing?: string) {
    if (this.valid(binding, existing)) return existing!;
    const nonce = randomBytes(32).toString('hex');
    return nonce + '.' + this.sign(binding, nonce);
  }
  verify(binding: string, header: string | undefined, stored: string | undefined) {
    if (
      !header ||
      !stored ||
      header.length !== stored.length ||
      !this.valid(binding, header) ||
      !timingSafeEqual(Buffer.from(header), Buffer.from(stored))
    )
      throw new ForbiddenException({
        code: 'CSRF_INVALID',
        message: 'Phiên xác thực yêu cầu không hợp lệ',
      });
  }
  preauthBinding(value: string | undefined) {
    if (!value || !/^\d{13}\.[0-9a-f]{64}$/.test(value)) return;
    const age = Date.now() - Number(value.split('.')[0]);
    return age >= 0 && age < 600000 ? 'pre:' + value : undefined;
  }
}
