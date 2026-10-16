import { Module } from '@nestjs/common';
import { PaymentReadsService } from './application/payment-reads.service';

@Module({ providers: [PaymentReadsService], exports: [PaymentReadsService] })
export class FinanceModule {}
