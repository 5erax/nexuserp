import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { ENVIRONMENT, type Environment } from '../../config/environment';
import type { CorrelatedRequest } from '../http';
import { AuthService } from '../../modules/iam/application/auth.service';
import type { Actor } from '../../modules/iam/domain/access-scope';
import { ACCESS, type AccessPolicy } from './access';
import { cookie } from './cookies';
import { CsrfService } from './csrf.service';
import { RateLimiter } from './rate-limiter';
import { clientAddress } from './client-address';
export type AuthorizedRequest = CorrelatedRequest & { actor: Actor };
@Injectable()
export class SecurityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly csrf: CsrfService,
    private readonly limiter: RateLimiter,
    @Inject(ENVIRONMENT) private readonly config: Environment,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthorizedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store');
    const policy = this.reflector.getAllAndOverride<AccessPolicy | undefined>(ACCESS, [
      context.getHandler(),
      context.getClass(),
    ]);
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (unsafe && request.headers.origin !== this.config.WEB_ORIGIN)
      throw new ForbiddenException({ code: 'CSRF_INVALID', message: 'Nguồn yêu cầu không hợp lệ' });
    const ip = clientAddress(request, this.config.TRUSTED_PROXY_IP);
    request.clientIp = ip;
    this.limiter.take('api:' + ip, this.config.API_RATE_LIMIT, 60000, response);
    if (policy === 'login') {
      this.limiter.take('login-ip:' + ip, 10, 900000, response);
      const body = request.body as Record<string, unknown> | undefined;
      const email =
        typeof body?.email === 'string' ? body.email.trim().toLowerCase().slice(0, 254) : '';
      const org =
        typeof body?.organizationCode === 'string'
          ? body.organizationCode.trim().toUpperCase().slice(0, 32)
          : '';
      this.limiter.take('login-account:' + org + ':' + email, 10, 900000, response);
    }
    if (policy === 'refresh') this.limiter.take('refresh:' + ip, 60, 60000, response);
    if (policy === 'public' && request.path === '/api/v1/auth/csrf')
      this.limiter.take('csrf:' + ip, 60, 60000, response);
    if (policy === 'public' && !unsafe) return true;
    let binding: string | undefined;
    if (policy === 'login') binding = this.csrf.preauthBinding(cookie(request, 'nexus_preauth'));
    else if (policy === 'refresh' || policy === 'logout') {
      const refresh = await this.auth.refreshBinding(cookie(request, 'nexus_refresh'));
      const familyBinding = refresh ? 'family:' + refresh.familyId : undefined;
      const active =
        refresh &&
        !refresh.revokedAt &&
        !refresh.family.revokedAt &&
        refresh.family.expiresAt > new Date() &&
        refresh.expiresAt > new Date() &&
        refresh.family.user.status === 'ACTIVE';
      const preauthBinding = this.csrf.preauthBinding(cookie(request, 'nexus_preauth'));
      const header = request.headers['x-csrf-token'];
      const preauthValid =
        preauthBinding && typeof header === 'string' && this.csrf.valid(preauthBinding, header);
      binding = active ? familyBinding : preauthValid ? preauthBinding : familyBinding;
    } else {
      request.actor = await this.auth.actor(cookie(request, 'nexus_access'));
      binding = 'family:' + request.actor.familyId;
    }
    if (unsafe) {
      const header = request.headers['x-csrf-token'];
      if (!binding)
        throw new ForbiddenException({
          code: 'CSRF_INVALID',
          message: 'Phiên xác thực yêu cầu không hợp lệ',
        });
      this.csrf.verify(
        binding,
        typeof header === 'string' ? header : undefined,
        cookie(request, 'nexus_csrf'),
      );
    }
    if (policy === 'login' || policy === 'refresh' || policy === 'logout' || policy === 'session')
      return true;
    if (!policy || typeof policy === 'string' || !request.actor.grants[policy.permission]?.length)
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Bạn không có quyền thực hiện thao tác này',
      });
    if (request.actor.mustChangePassword)
      throw new ForbiddenException({
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Bạn cần đổi mật khẩu trước khi tiếp tục',
      });
    return true;
  }
}
