import { Module } from '@nestjs/common';
import { StockLedgerService } from './application/stock-ledger.service';
import { ReservationsService } from './application/reservations.service';

@Module({
  providers: [StockLedgerService, ReservationsService],
  exports: [StockLedgerService, ReservationsService],
})
export class InventoryModule {}
