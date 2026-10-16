import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { Prisma } from '../../../generated/prisma/client';
import { StockLedgerService } from './stock-ledger.service';

type Selection = { organizationId: string; warehouseId: string; referenceId: string };
export type ReserveInput = Selection & {
  items: { variantId: string; quantity: string; orderItemId: string }[];
};
export type ConsumeInput = Selection & { createdBy: string; shipmentId: string };
const conflict = (code: string, message: string) => new ConflictException({ code, message });

@Injectable()
export class ReservationsService {
  constructor(private readonly ledger: StockLedgerService) {}
  async hasForOrder(tx: Prisma.TransactionClient, organizationId: string, referenceId: string) {
    if (typeof Reflect.get(tx, '$connect') === 'function')
      throw new Error('Reservations require a caller transaction');
    return Boolean(
      await tx.stockReservation.findFirst({
        where: { organizationId, referenceId },
        select: { id: true },
      }),
    );
  }

  private async lockReference(tx: Prisma.TransactionClient, input: Selection) {
    if (typeof Reflect.get(tx, '$connect') === 'function')
      throw new Error('Reservations require a caller transaction');
    if (
      ![input.organizationId, input.warehouseId, input.referenceId].every(
        (id) => typeof id === 'string' && isUUID(id),
      )
    )
      throw new BadRequestException();
    // Serialize a reference before locking its balances, including reserve versus release/consume.
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          'reservation',
          input.organizationId.toLowerCase(),
          input.referenceId.toLowerCase(),
        ]),
      )
      .digest()
      .readBigInt64BE();
    await tx.$queryRaw`SELECT id FROM sales_orders WHERE organization_id = ${input.organizationId}::uuid AND id = ${input.referenceId}::uuid FOR SHARE`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${key}::bigint)::text`;
  }

  private lockBalances(tx: Prisma.TransactionClient, organizationId: string, ids: string[]) {
    return tx.$queryRaw(Prisma.sql`SELECT id FROM stock_balances
      WHERE organization_id = ${organizationId}::uuid AND id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY id FOR NO KEY UPDATE`);
  }

  private async insufficient(
    tx: Prisma.TransactionClient,
    variantId: string,
    quantity: string,
    balanceId?: string,
  ): Promise<never> {
    const balance = balanceId
      ? await tx.stockBalance.findUniqueOrThrow({ where: { id: balanceId } })
      : null;
    throw new ConflictException({
      code: 'INSUFFICIENT_STOCK',
      message: 'Không đủ tồn kho khả dụng',
      details: {
        variantId,
        requested: new Prisma.Decimal(quantity).toFixed(3),
        available: balance ? balance.onHand.minus(balance.reserved).toFixed(3) : '0.000',
      },
    });
  }

  async reserve(tx: Prisma.TransactionClient, input: ReserveInput) {
    const items = input.items;
    if (
      !Array.isArray(items) ||
      items.length === 0 ||
      items.length > 100 ||
      items.some(
        (item) =>
          !item ||
          typeof item.variantId !== 'string' ||
          !isUUID(item.variantId) ||
          typeof item.orderItemId !== 'string' ||
          !isUUID(item.orderItemId) ||
          typeof item.quantity !== 'string' ||
          !/^\d{1,15}(?:\.\d{1,3})?$/.test(item.quantity) ||
          new Prisma.Decimal(item.quantity).isZero(),
      ) ||
      new Set(items.map((item) => item.variantId.toLowerCase())).size !== items.length
    )
      throw new BadRequestException();
    await this.lockReference(tx, input);
    const { organizationId, warehouseId, referenceId } = input;
    if (
      await tx.stockReservation.findFirst({
        where: { organizationId, referenceId },
        select: { id: true },
      })
    )
      throw conflict('RESERVATION_ALREADY_EXISTS', 'Tham chiếu đã được giữ hàng');
    const rows = await tx.stockBalance.findMany({
      where: {
        organizationId,
        warehouseId,
        variantId: { in: items.map((item) => item.variantId) },
      },
      select: { id: true, variantId: true },
      orderBy: { id: 'asc' },
    });
    const quantities = new Map(items.map((item) => [item.variantId.toLowerCase(), item.quantity]));
    const missing = items.find(
      (item) => !rows.some((row) => row.variantId === item.variantId.toLowerCase()),
    );
    if (missing) return this.insufficient(tx, missing.variantId, missing.quantity);
    const orderItems = await tx.salesOrderItem.findMany({
      where: {
        organizationId,
        orderId: referenceId,
        id: { in: items.map((item) => item.orderItemId) },
        order: { warehouseId, status: { in: ['DRAFT', 'CONFIRMED'] } },
      },
      select: { id: true, variantId: true, quantity: true },
    });
    if (orderItems.length !== items.length) throw new NotFoundException();
    if (
      items.some(
        (item) =>
          !orderItems.some(
            (row) =>
              row.id === item.orderItemId.toLowerCase() &&
              row.variantId === item.variantId.toLowerCase() &&
              row.quantity.equals(item.quantity),
          ),
      )
    )
      throw new BadRequestException('Giữ hàng phải khớp dòng đơn');
    await this.lockBalances(
      tx,
      organizationId,
      rows.map((row) => row.id),
    );
    const reservations = [];
    for (const row of rows) {
      const quantity = quantities.get(row.variantId)!;
      const changed = await tx.$executeRaw`UPDATE stock_balances
        SET reserved = reserved + ${quantity}::numeric, version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE organization_id = ${organizationId}::uuid AND id = ${row.id}::uuid AND on_hand - reserved >= ${quantity}::numeric`;
      if (!changed) return this.insufficient(tx, row.variantId, quantity, row.id);
      reservations.push(
        await tx.stockReservation.create({
          data: {
            organizationId,
            balanceId: row.id,
            referenceId,
            quantity,
            orderItemId: items.find((item) => item.variantId.toLowerCase() === row.variantId)!
              .orderItemId,
          },
        }),
      );
    }
    return reservations;
  }

  release(tx: Prisma.TransactionClient, input: Selection) {
    return this.finish(tx, input);
  }

  consume(tx: Prisma.TransactionClient, input: ConsumeInput) {
    if (![input.createdBy, input.shipmentId].every((id) => typeof id === 'string' && isUUID(id)))
      throw new BadRequestException();
    return this.finish(tx, input, input);
  }

  private async finish(tx: Prisma.TransactionClient, input: Selection, shipment?: ConsumeInput) {
    await this.lockReference(tx, input);
    const { organizationId, warehouseId, referenceId } = input;
    const rows = await tx.stockReservation.findMany({
      where: { organizationId, referenceId, balance: { warehouseId } },
      include: { balance: { select: { variantId: true } } },
      orderBy: { balanceId: 'asc' },
    });
    if (!rows.length) throw new NotFoundException();
    if (rows.some((row) => row.status !== 'ACTIVE'))
      throw conflict('RESERVATION_NOT_ACTIVE', 'Giữ hàng đã kết thúc');
    await this.lockBalances(
      tx,
      organizationId,
      rows.map((row) => row.balanceId),
    );
    const finished = [];
    for (const row of rows) {
      const quantity = row.quantity.toFixed(3);
      const changed = await tx.$executeRaw`UPDATE stock_balances
        SET reserved = reserved - ${quantity}::numeric, version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE organization_id = ${organizationId}::uuid AND id = ${row.balanceId}::uuid AND reserved >= ${quantity}::numeric`;
      if (!changed)
        throw conflict('STOCK_BALANCE_MISMATCH', 'Số dư giữ hàng không khớp, cần đối soát');
      if (shipment)
        await this.ledger.post(tx, {
          organizationId,
          warehouseId,
          variantId: row.balance.variantId,
          createdBy: shipment.createdBy,
          referenceId: shipment.shipmentId,
          referenceType: 'SHIPMENT_OUT',
          quantityDelta: row.quantity.negated().toFixed(3),
        });
      finished.push(
        await tx.stockReservation.update({
          where: { id: row.id },
          data: { status: shipment ? 'CONSUMED' : 'RELEASED' },
        }),
      );
    }
    return finished;
  }
}
