import { Module } from '@nestjs/common';
import { StockLedgerService } from './application/stock-ledger.service';
import { ReservationsService } from './application/reservations.service';
import { ReconciliationService } from './application/reconciliation.service';
import { ReconciliationController } from './presentation/reconciliation.controller';

@Module({
  providers: [StockLedgerService, ReservationsService, ReconciliationService],
  exports: [StockLedgerService, ReservationsService, ReconciliationService],
  controllers: [ReconciliationController],
})
export class InventoryModule {}
