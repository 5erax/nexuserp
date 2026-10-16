import { ConflictException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';

export async function nextSalesOrderNumber(
  tx: Prisma.TransactionClient,
  organizationId: string,
  year: number,
) {
  if (typeof Reflect.get(tx, '$connect') === 'function')
    throw new Error('Document numbers require a caller transaction');
  const [sequence] = await tx.$queryRaw<
    { value: bigint }[]
  >`INSERT INTO document_sequences (organization_id,kind,year,next_value)
    VALUES (${organizationId}::uuid,'SO',${year},2)
    ON CONFLICT (organization_id,kind,year) DO UPDATE SET next_value = document_sequences.next_value + 1
    WHERE document_sequences.next_value < 9223372036854775807
    RETURNING next_value - 1 AS value`;
  if (!sequence)
    throw new ConflictException({
      code: 'ORDER_NUMBER_EXHAUSTED',
      message: 'Đã hết miền số đơn hàng',
    });
  return `SO-${year}-${sequence.value.toString().padStart(6, '0')}`;
}
