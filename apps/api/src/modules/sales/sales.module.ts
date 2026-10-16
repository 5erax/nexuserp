import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { AuditModule } from '../audit/audit.module';
import { InventoryModule } from '../inventory/inventory.module';
import { OrdersService } from './application/orders.service';
import { OrdersController } from './presentation/orders.controller';

@Module({
  imports: [IamModule, AuditModule, InventoryModule],
  providers: [OrdersService],
  controllers: [OrdersController],
})
export class SalesModule {}
