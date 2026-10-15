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
    await tx.stockAdjustmentItem.deleteMany({ where });
    await tx.stockAdjustment.deleteMany({ where });
    await tx.warehouse.deleteMany({ where });
    await tx.productVariant.deleteMany({ where });
    await tx.product.deleteMany({ where });
    await tx.documentSequence.deleteMany({ where });
  });
}
