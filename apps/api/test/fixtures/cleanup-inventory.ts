import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

export async function cleanupInventory(prisma: PrismaService, organizationIds: string[]) {
  await prisma.$transaction(async (tx) => {
    const [database] = await tx.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
    if (!database?.name.endsWith('_test') || organizationIds.length === 0)
      throw new Error('Cleanup requires owned test fixtures');
    const where = { organizationId: { in: organizationIds } };
    // The exclusive DDL lock keeps the trigger enabled for other connections.
    await tx.$executeRaw`ALTER TABLE stock_movements DISABLE TRIGGER stock_movements_immutable`;
    await tx.stockMovement.deleteMany({ where });
    await tx.$executeRaw`ALTER TABLE stock_movements ENABLE TRIGGER stock_movements_immutable`;
    await tx.stockReservation.deleteMany({ where });
    await tx.stockBalance.deleteMany({ where });
    await tx.$executeRaw`ALTER TABLE order_events DISABLE TRIGGER order_events_immutable`;
    await tx.$executeRaw`ALTER TABLE payments DISABLE TRIGGER payments_immutable`;
    await tx.$executeRaw`ALTER TABLE shipment_items DISABLE TRIGGER shipment_items_immutable`;
    await tx.$executeRaw`ALTER TABLE shipments DISABLE TRIGGER shipments_immutable`;
    await tx.$executeRaw`ALTER TABLE sales_order_items DISABLE TRIGGER sales_order_items_immutable`;
    await tx.$executeRaw`ALTER TABLE sales_orders DISABLE TRIGGER sales_orders_immutable`;
    await tx.orderEvent.deleteMany({ where });
    await tx.payment.deleteMany({ where });
    await tx.shipmentItem.deleteMany({ where });
    await tx.shipment.deleteMany({ where });
    await tx.salesOrderItem.deleteMany({ where });
    await tx.salesOrder.deleteMany({ where });
    await tx.customer.deleteMany({ where });
    await tx.$executeRaw`ALTER TABLE outbox_receipts DISABLE TRIGGER outbox_receipts_immutable`;
    await tx.outboxReceipt.deleteMany({ where });
    await tx.$executeRaw`ALTER TABLE outbox_receipts ENABLE TRIGGER outbox_receipts_immutable`;
    await tx.outboxEvent.deleteMany({ where });
    await tx.$executeRaw`ALTER TABLE order_events ENABLE TRIGGER order_events_immutable`;
    await tx.$executeRaw`ALTER TABLE payments ENABLE TRIGGER payments_immutable`;
    await tx.$executeRaw`ALTER TABLE shipment_items ENABLE TRIGGER shipment_items_immutable`;
    await tx.$executeRaw`ALTER TABLE shipments ENABLE TRIGGER shipments_immutable`;
    await tx.$executeRaw`ALTER TABLE sales_order_items ENABLE TRIGGER sales_order_items_immutable`;
    await tx.$executeRaw`ALTER TABLE sales_orders ENABLE TRIGGER sales_orders_immutable`;
    await tx.$executeRaw`ALTER TABLE stock_adjustment_items DISABLE TRIGGER stock_adjustment_items_immutable`;
    await tx.$executeRaw`ALTER TABLE stock_adjustments DISABLE TRIGGER stock_adjustments_immutable`;
    await tx.stockAdjustmentItem.deleteMany({ where });
    await tx.stockAdjustment.deleteMany({ where });
    await tx.$executeRaw`ALTER TABLE stock_adjustment_items ENABLE TRIGGER stock_adjustment_items_immutable`;
    await tx.$executeRaw`ALTER TABLE stock_adjustments ENABLE TRIGGER stock_adjustments_immutable`;
    await tx.warehouse.deleteMany({ where });
    await tx.productVariant.deleteMany({ where });
    await tx.product.deleteMany({ where });
    await tx.documentSequence.deleteMany({ where });
  });
}
