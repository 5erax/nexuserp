import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { AuditModule } from '../audit/audit.module';
import { InventoryModule } from '../inventory/inventory.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CustomerDirectoryModule } from '../crm/customer-directory.module';
import { FinanceModule } from '../finance/finance.module';
import { OrdersService } from './application/orders.service';
import { OrdersController } from './presentation/orders.controller';

@Module({
  imports: [
    IamModule,
    AuditModule,
    InventoryModule,
    CatalogModule,
    CustomerDirectoryModule,
    FinanceModule,
  ],
  providers: [OrdersService],
  exports: [OrdersService],
  controllers: [OrdersController],
})
export class SalesModule {}
