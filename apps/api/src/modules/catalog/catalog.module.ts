import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { IamModule } from '../iam/iam.module';
import { CatalogService } from './application/catalog.service';
import { CatalogController } from './presentation/catalog.controller';
@Module({
  imports: [IamModule, AuditModule],
  providers: [CatalogService],
  controllers: [CatalogController],
})
export class CatalogModule {}
