import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiHeader,
  ApiOkResponse,
  ApiProperty,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength, Matches } from 'class-validator';
import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import { AuthRoute, Session } from '../../../common/security/access';
import { CsrfService } from '../../../common/security/csrf.service';
import { cookie, cookieOptions, clearSession } from '../../../common/security/cookies';
import type { AuthorizedRequest } from '../../../common/security/security.guard';
import { ENVIRONMENT, type Environment } from '../../../config/environment';
import { AuthService } from '../application/auth.service';

export class LoginInput {
  @ApiProperty()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,32}$/)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  organizationCode!: string;
  @ApiProperty()
  @IsEmail()
  @MaxLength(254)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email!: string;
  @ApiProperty({ writeOnly: true }) @IsString() @MinLength(1) @MaxLength(128) password!: string;
}
export class ChangePasswordInput {
  @ApiProperty({ writeOnly: true })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;
  @ApiProperty({ writeOnly: true }) @IsString() @MinLength(12) @MaxLength(128) newPassword!: string;
}
class Meta {
  @ApiProperty() requestId!: string;
}
class CsrfData {
  @ApiProperty() csrfToken!: string;
}
class CsrfResponse {
  @ApiProperty({ type: CsrfData }) data!: CsrfData;
  @ApiProperty({ type: Meta }) meta!: Meta;
}
class SessionData {
  @ApiProperty() authenticated!: boolean;
}
class SessionResponse {
  @ApiProperty({ type: SessionData }) data!: SessionData;
  @ApiProperty({ type: Meta }) meta!: Meta;
}
class RoleData {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
}
class Profile {
  @ApiProperty() id!: string;
  @ApiProperty() organizationId!: string;
  @ApiProperty() email!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() mustChangePassword!: boolean;
  @ApiProperty({ type: [RoleData] }) roles!: RoleData[];
  @ApiProperty({
    type: 'object',
    additionalProperties: {
      type: 'array',
      items: { type: 'string', enum: ['ORG', 'BRANCH', 'OWN'] },
    },
  })
  grants!: Record<string, string[]>;
  @ApiProperty({ type: [String] }) branchIds!: string[];
}
class ProfileResponse {
  @ApiProperty({ type: Profile }) data!: Profile;
  @ApiProperty({ type: Meta }) meta!: Meta;
}
const auditContext = (request: AuthorizedRequest) => ({
  requestId: request.requestId,
  ip: (request.clientIp ?? request.socket.remoteAddress)?.slice(0, 64),
  userAgent: request.headers['user-agent']?.slice(0, 512),
});
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly csrf: CsrfService,
    @Inject(ENVIRONMENT) private readonly config: Environment,
  ) {}
  private get secure() {
    return this.config.NODE_ENV === 'production';
  }
  @Get('csrf')
  @AuthRoute('csrf')
  @ApiOkResponse({ type: CsrfResponse })
  async bootstrap(
    @Req() request: AuthorizedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.auth.refreshBinding(cookie(request, 'nexus_refresh'));
    let binding: string;
    if (
      session &&
      !session.family.revokedAt &&
      session.family.expiresAt > new Date() &&
      session.family.user.status === 'ACTIVE'
    )
      binding = 'family:' + session.familyId;
    else {
      let preauth = cookie(request, 'nexus_preauth');
      if (!this.csrf.preauthBinding(preauth))
        preauth = Date.now() + '.' + randomBytes(32).toString('hex');
      binding = this.csrf.preauthBinding(preauth)!;
      response.cookie('nexus_preauth', preauth, {
        ...cookieOptions(this.secure, '/api/v1/auth'),
        maxAge: 600000,
      });
    }
    const csrfToken = this.csrf.issue(binding, cookie(request, 'nexus_csrf'));
    response.cookie('nexus_csrf', csrfToken, {
      ...cookieOptions(this.secure, '/', false),
      maxAge: binding.startsWith('family:')
        ? Math.max(0, session!.family.expiresAt.getTime() - Date.now())
        : 600000,
    });
    return { csrfToken };
  }
  private setSession(
    response: Response,
    session: { accessToken: string; refreshToken: string; expiresAt: Date; familyId: string },
    existingCsrf?: string,
  ) {
    const maxAge = Math.max(0, session.expiresAt.getTime() - Date.now());
    response.cookie('nexus_access', session.accessToken, {
      ...cookieOptions(this.secure, '/api/v1'),
      maxAge: Math.min(900000, maxAge),
    });
    response.cookie('nexus_refresh', session.refreshToken, {
      ...cookieOptions(this.secure, '/api/v1/auth'),
      maxAge,
    });
    response.cookie('nexus_csrf', this.csrf.issue('family:' + session.familyId, existingCsrf), {
      ...cookieOptions(this.secure, '/', false),
      maxAge,
    });
  }
  @Post('login')
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @HttpCode(200)
  @AuthRoute('login')
  @ApiOkResponse({ type: SessionResponse })
  async login(
    @Body() input: LoginInput,
    @Req() request: AuthorizedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.auth.login(input, auditContext(request));
    this.setSession(response, session);
    response.clearCookie('nexus_preauth', cookieOptions(this.secure, '/api/v1/auth'));
    return { authenticated: true };
  }
  @Post('refresh')
  @ApiSecurity('refreshCookie')
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @HttpCode(200)
  @AuthRoute('refresh')
  @ApiOkResponse({ type: SessionResponse })
  async refresh(@Req() request: AuthorizedRequest, @Res({ passthrough: true }) response: Response) {
    const session = await this.auth.refresh(
      cookie(request, 'nexus_refresh'),
      auditContext(request),
    );
    if (session.kind === 'conflict')
      throw new ConflictException({
        code: 'REFRESH_CONFLICT',
        message: 'Phiên đang được làm mới bởi yêu cầu khác',
      });
    if (session.kind !== 'ok') {
      clearSession(response, this.secure);
      throw new UnauthorizedException({
        code: session.kind === 'reused' ? 'REFRESH_REUSE_DETECTED' : 'SESSION_INVALID',
        message: 'Phiên đăng nhập không còn hiệu lực',
      });
    }
    this.setSession(
      response,
      { ...session, accessToken: await this.auth.accessToken(session) },
      cookie(request, 'nexus_csrf'),
    );
    return { authenticated: true };
  }
  @Post('logout')
  @ApiSecurity('refreshCookie')
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @HttpCode(200)
  @AuthRoute('logout')
  @ApiOkResponse({ type: SessionResponse })
  async logout(@Req() request: AuthorizedRequest, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(cookie(request, 'nexus_refresh'), auditContext(request));
    clearSession(response, this.secure);
    return { authenticated: false };
  }
  @Get('me')
  @ApiCookieAuth()
  @Session()
  @ApiOkResponse({ type: ProfileResponse })
  me(@Req() request: AuthorizedRequest): Profile {
    const actor = request.actor;
    return {
      id: actor.id,
      organizationId: actor.organizationId,
      email: actor.email,
      displayName: actor.displayName,
      mustChangePassword: actor.mustChangePassword,
      roles: actor.roles,
      grants: actor.grants,
      branchIds: actor.branchIds,
    };
  }
  @Post('password')
  @ApiCookieAuth()
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @HttpCode(200)
  @Session()
  @ApiOkResponse({ type: SessionResponse })
  async password(
    @Body() input: ChangePasswordInput,
    @Req() request: AuthorizedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.changePassword(request.actor, input, auditContext(request));
    clearSession(response, this.secure);
    return { authenticated: false };
  }
}
