import { Module } from '@nestjs/common';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { IamModule } from './modules/iam/iam.module';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { SalesModule } from './modules/sales/sales.module';
import { CrmModule } from './modules/crm/crm.module';
import { OutboxModule } from './modules/outbox/outbox.module';
@Module({
  imports: [
    PrismaModule,
    HealthModule,
    IamModule,
    IdempotencyModule,
    CatalogModule,
    InventoryModule,
    SalesModule,
    CrmModule,
    OutboxModule,
  ],
})
export class AppModule {}
