import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { ListResult } from '../../../common/pagination';
import type { Actor } from '../../iam/application/access-scope';

type Query = { page: number; pageSize: number; warehouseId?: string };
type Difference = {
  warehouseId: string;
  warehouseName: string;
  branchId: string;
  variantId: string;
  sku: string;
  variantName: string;
  onHand: string;
  expectedOnHand: string;
  reserved: string;
  expectedReserved: string;
  missingBalance: boolean;
};

@Injectable()
export class ReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  list(actor: Actor, query: Query) {
    if (!actor.grants['inventory.balances.read']?.includes('ORG')) throw new ForbiddenException();
    return this.check(actor.organizationId, query);
  }

  check(organizationId: string, query: Query) {
    return this.prisma.$transaction(
      async (tx) => {
        if (
          !(await tx.organization.findUnique({
            where: { id: organizationId },
            select: { id: true },
          }))
        )
          throw new NotFoundException();
        if (
          query.warehouseId &&
          !(await tx.warehouse.findFirst({
            where: { organizationId, id: query.warehouseId },
            select: { id: true },
          }))
        )
          throw new NotFoundException();
        const warehouse = query.warehouseId
          ? Prisma.sql`AND warehouse_id = ${query.warehouseId}::uuid`
          : Prisma.empty;
        const differences = Prisma.sql`WITH balances AS (
        SELECT * FROM stock_balances WHERE organization_id = ${organizationId}::uuid ${warehouse}
      ), ledger AS (
        SELECT warehouse_id, variant_id, SUM(quantity_delta) AS expected_on_hand
        FROM stock_movements WHERE organization_id = ${organizationId}::uuid ${warehouse}
        GROUP BY warehouse_id, variant_id
      ), held AS (
        SELECT r.balance_id, SUM(r.quantity) AS expected_reserved
        FROM stock_reservations r JOIN balances b ON b.id = r.balance_id
        WHERE r.organization_id = ${organizationId}::uuid AND r.status = 'ACTIVE'
        GROUP BY r.balance_id
      ), differences AS (
        SELECT COALESCE(b.warehouse_id, l.warehouse_id) AS warehouse_id, COALESCE(b.variant_id, l.variant_id) AS variant_id,
          COALESCE(b.on_hand, 0)::text AS "onHand", COALESCE(l.expected_on_hand, 0)::text AS "expectedOnHand",
          COALESCE(b.reserved, 0)::text AS reserved, COALESCE(h.expected_reserved, 0)::text AS "expectedReserved", b.id IS NULL AS "missingBalance"
        FROM balances b FULL JOIN ledger l ON l.warehouse_id = b.warehouse_id AND l.variant_id = b.variant_id
        LEFT JOIN held h ON h.balance_id = b.id
        WHERE b.id IS NULL OR b.on_hand <> COALESCE(l.expected_on_hand, 0) OR b.reserved <> COALESCE(h.expected_reserved, 0)
      )`;
        const [count] = await tx.$queryRaw<{ total: bigint }[]>(
          Prisma.sql`${differences} SELECT COUNT(*) AS total FROM differences`,
        );
        const rows = await tx.$queryRaw<Difference[]>(Prisma.sql`${differences}
        SELECT d.warehouse_id AS "warehouseId", w.name AS "warehouseName", w.branch_id AS "branchId",
          d.variant_id AS "variantId", v.sku, v.name AS "variantName", d."onHand", d."expectedOnHand", d.reserved, d."expectedReserved", d."missingBalance"
        FROM differences d JOIN warehouses w ON w.id = d.warehouse_id AND w.organization_id = ${organizationId}::uuid
        JOIN product_variants v ON v.id = d.variant_id AND v.organization_id = ${organizationId}::uuid
        ORDER BY d.warehouse_id, d.variant_id LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`);
        return new ListResult(
          rows.map((row) => ({
            ...row,
            onHand: new Prisma.Decimal(row.onHand).toFixed(3),
            expectedOnHand: new Prisma.Decimal(row.expectedOnHand).toFixed(3),
            reserved: new Prisma.Decimal(row.reserved).toFixed(3),
            expectedReserved: new Prisma.Decimal(row.expectedReserved).toFixed(3),
          })),
          { page: query.page, pageSize: query.pageSize, total: Number(count!.total) },
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
