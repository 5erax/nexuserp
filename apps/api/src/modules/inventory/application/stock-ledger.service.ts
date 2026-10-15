import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';

export type MovementInput = {
  organizationId: string;
  warehouseId: string;
  variantId: string;
  createdBy: string;
  referenceId: string;
  referenceType: 'OPENING' | 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT' | 'SHIPMENT_OUT';
  quantityDelta: string;
  unitCost?: string | null;
};

@Injectable()
export class StockLedgerService {
  async post(tx: Prisma.TransactionClient, input: MovementInput) {
    // PrismaClient is structurally assignable to TransactionClient; reject accidental autocommit.
    if (typeof Reflect.get(tx, '$connect') === 'function')
      throw new Error('Stock posting requires a caller transaction');
    const { organizationId, warehouseId, variantId, quantityDelta, referenceType } = input;
    const inbound = referenceType === 'OPENING' || referenceType === 'ADJUSTMENT_IN';
    if (
      !['OPENING', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'SHIPMENT_OUT'].includes(referenceType) ||
      typeof quantityDelta !== 'string' ||
      !/^-?\d{1,15}(?:\.\d{1,3})?$/.test(quantityDelta) ||
      (input.unitCost != null &&
        (!inbound ||
          typeof input.unitCost !== 'string' ||
          !/^\d{1,14}(?:\.\d{1,6})?$/.test(input.unitCost)))
    )
      throw new BadRequestException({
        code: 'INVALID_MOVEMENT',
        message: 'Biến động tồn kho không hợp lệ',
      });
    const delta = new Prisma.Decimal(quantityDelta);
    if (delta.isZero() || delta.isPositive() !== inbound)
      throw new BadRequestException({
        code: 'INVALID_MOVEMENT',
        message: 'Chiều biến động tồn kho không hợp lệ',
      });

    await tx.$executeRaw`
      INSERT INTO stock_balances (id, organization_id, warehouse_id, variant_id, updated_at)
      VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${warehouseId}::uuid, ${variantId}::uuid, CURRENT_TIMESTAMP)
      ON CONFLICT (organization_id, warehouse_id, variant_id) DO NOTHING`;
    const changed = await tx.$executeRaw`
      UPDATE stock_balances
      SET on_hand = on_hand + ${quantityDelta}::numeric, version = version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE organization_id = ${organizationId}::uuid AND warehouse_id = ${warehouseId}::uuid AND variant_id = ${variantId}::uuid
        AND on_hand + ${quantityDelta}::numeric >= reserved
        AND on_hand + ${quantityDelta}::numeric <= 999999999999999.999`;
    if (!changed) {
      const row = await tx.stockBalance.findUniqueOrThrow({
        where: { organizationId_warehouseId_variantId: { organizationId, warehouseId, variantId } },
      });
      throw new ConflictException({
        code: inbound ? 'STOCK_LIMIT_EXCEEDED' : 'INSUFFICIENT_STOCK',
        message: inbound ? 'Số dư vượt giới hạn lưu trữ' : 'Không đủ tồn kho khả dụng',
        details: {
          variantId,
          requested: delta.abs().toFixed(3),
          available: row.onHand.minus(row.reserved).toFixed(3),
        },
      });
    }
    try {
      return await tx.stockMovement.create({
        data: { ...input, unitCost: input.unitCost ?? null },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException({
          code: 'MOVEMENT_ALREADY_POSTED',
          message: 'Biến động đã được ghi nhận',
        });
      throw error;
    }
  }
}
