import { Module } from '@nestjs/common';
import { OrganizationRepository } from './infrastructure/organization.repository';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuditModule } from '../audit/audit.module';
import { AuthService } from './application/auth.service';
import { PasswordService } from './application/password.service';
import { AuthController } from './presentation/auth.controller';
import { SecurityGuard } from '../../common/security/security.guard';
import { CsrfService } from '../../common/security/csrf.service';
import { RateLimiter } from '../../common/security/rate-limiter';
import { UsersController } from './presentation/users.controller';
import { UsersService } from './application/users.service';
import { IamAdminPolicy } from './application/admin-policy.service';
import { RolesService } from './application/roles.service';
import { RolesController } from './presentation/roles.controller';
import { OrganizationService } from './application/organization.service';
import { OrganizationController } from './presentation/organization.controller';
@Module({
  imports: [JwtModule.register({}), AuditModule],
  controllers: [AuthController, UsersController, RolesController, OrganizationController],
  providers: [
    OrganizationRepository,
    AuthService,
    PasswordService,
    CsrfService,
    RateLimiter,
    UsersService,
    IamAdminPolicy,
    RolesService,
    OrganizationService,
    { provide: APP_GUARD, useClass: SecurityGuard },
  ],
  exports: [OrganizationRepository, AuthService, PasswordService],
})
export class IamModule {}
