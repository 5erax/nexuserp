import { randomUUID } from 'node:crypto';
import { Prisma } from '../../src/generated/prisma/client';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

export type ReservationDraft = {
  organizationId: string;
  warehouseId: string;
  referenceId: string;
  items: { variantId: string; quantity: string }[];
};

export async function reservationFixtures(prisma: PrismaService, inputs: ReservationDraft[]) {
  const first = inputs[0];
  if (
    !first ||
    inputs.some(
      (input) =>
        input.organizationId !== first.organizationId || input.warehouseId !== first.warehouseId,
    )
  )
    throw new Error('Reservation fixture batch requires one owned organization/warehouse');
  return prisma.$transaction(async (tx) => {
    const [database] = await tx.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
    if (!database?.name.endsWith('_test'))
      throw new Error('Reservation fixtures require an explicit _test database');
    const { organizationId, warehouseId } = first;
    const warehouse = await tx.warehouse.findFirstOrThrow({
      where: { organizationId, id: warehouseId },
    });
    const actor = await tx.user.findFirstOrThrow({
      where: { organizationId },
      orderBy: { id: 'asc' },
    });
    const customer = await tx.customer.upsert({
      where: { id: warehouse.branchId },
      update: {},
      create: {
        id: warehouse.branchId,
        organizationId,
        branchId: warehouse.branchId,
        createdBy: actor.id,
        name: 'Reservation fixture customer',
      },
    });
    const variants = await tx.productVariant.findMany({
      where: {
        organizationId,
        id: {
          in: [...new Set(inputs.flatMap((input) => input.items.map((item) => item.variantId)))],
        },
      },
      include: { product: { select: { name: true } } },
    });
    const rows = inputs.flatMap((input) =>
      input.items.map((item) => {
        const variant = variants.find((variant) => variant.id === item.variantId.toLowerCase());
        if (!variant) throw new Error('Reservation fixture needs a real owned variant');
        return {
          id: randomUUID(),
          organizationId,
          orderId: input.referenceId,
          variantId: variant.id,
          sku: variant.sku,
          productName: variant.product.name,
          quantity: item.quantity,
          unitPrice: '1',
          lineTotal: new Prisma.Decimal(item.quantity).toDecimalPlaces(
            0,
            Prisma.Decimal.ROUND_HALF_UP,
          ),
        };
      }),
    );
    await tx.salesOrder.createMany({
      data: inputs.map((input) => {
        const subtotal = rows
          .filter((row) => row.orderId === input.referenceId)
          .reduce((sum, row) => sum.plus(row.lineTotal), new Prisma.Decimal(0));
        return {
          id: input.referenceId,
          organizationId,
          branchId: warehouse.branchId,
          warehouseId,
          customerId: customer.id,
          createdBy: actor.id,
          orderNumber: input.referenceId.replaceAll('-', '').toUpperCase(),
          subtotal,
          grandTotal: subtotal,
        };
      }),
      skipDuplicates: true,
    });
    await tx.salesOrderItem.createMany({ data: rows, skipDuplicates: true });
    const items = await tx.salesOrderItem.findMany({
      where: { organizationId, orderId: { in: inputs.map((input) => input.referenceId) } },
    });
    return inputs.map((input) => ({
      ...input,
      items: input.items.map((item) => ({
        ...item,
        orderItemId: items.find(
          (row) =>
            row.orderId === input.referenceId && row.variantId === item.variantId.toLowerCase(),
        )!.id,
      })),
    }));
  });
}
export async function reservationFixture(prisma: PrismaService, input: ReservationDraft) {
  return (await reservationFixtures(prisma, [input]))[0]!;
}
