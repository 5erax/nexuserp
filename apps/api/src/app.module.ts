import { Module } from '@nestjs/common';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { IamModule } from './modules/iam/iam.module';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { CatalogModule } from './modules/catalog/catalog.module';
@Module({ imports: [PrismaModule, HealthModule, IamModule, IdempotencyModule, CatalogModule] })
export class AppModule {}
