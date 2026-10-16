import { Module } from '@nestjs/common';
import { StockLedgerService } from './application/stock-ledger.service';
import { ReservationsService } from './application/reservations.service';
import { ReconciliationService } from './application/reconciliation.service';
import { ReconciliationController } from './presentation/reconciliation.controller';
import { WarehousesService } from './application/warehouses.service';
import { InventoryReadsService } from './application/inventory-reads.service';
import { InventoryController } from './presentation/inventory.controller';
import { IamModule } from '../iam/iam.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [IamModule, AuditModule],
  providers: [
    StockLedgerService,
    ReservationsService,
    ReconciliationService,
    WarehousesService,
    InventoryReadsService,
  ],
  exports: [StockLedgerService, ReservationsService, ReconciliationService, WarehousesService],
  controllers: [ReconciliationController, InventoryController],
})
export class InventoryModule {}
