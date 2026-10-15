import { Module } from '@nestjs/common';
import { OrganizationRepository } from './infrastructure/organization.repository';
@Module({ providers: [OrganizationRepository], exports: [OrganizationRepository] })
export class IamModule {}
