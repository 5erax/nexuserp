import { Module } from '@nestjs/common';
import { OutboxService } from './application/outbox.service';
import { OutboxDispatcher } from './application/outbox-dispatcher';
import { ReceiptConsumer } from './application/receipt-consumer';
import { OUTBOX_HANDLERS } from './application/handler';

@Module({
  providers: [
    OutboxService,
    ReceiptConsumer,
    {
      provide: OUTBOX_HANDLERS,
      useFactory: (receipt: ReceiptConsumer) => [receipt],
      inject: [ReceiptConsumer],
    },
    OutboxDispatcher,
  ],
  exports: [OutboxService],
})
export class OutboxModule {}
