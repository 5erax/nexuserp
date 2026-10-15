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
@Module({
  imports: [JwtModule.register({}), AuditModule],
  controllers: [AuthController],
  providers: [
    OrganizationRepository,
    AuthService,
    PasswordService,
    CsrfService,
    RateLimiter,
    { provide: APP_GUARD, useClass: SecurityGuard },
  ],
  exports: [OrganizationRepository, AuthService, PasswordService],
})
export class IamModule {}
