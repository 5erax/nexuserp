import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { ListResult } from '../../../common/pagination';
import { scopeFilter, type Actor } from '../../iam/application/access-scope';
import { z } from 'zod';

type Query = {
  page: number;
  pageSize: number;
  q?: string;
  warehouseId?: string;
  variantId?: string;
  sortOrder: 'asc' | 'desc';
};
type MovementQuery = Omit<Query, 'page' | 'pageSize' | 'sortOrder'> & {
  limit: number;
  cursor?: string;
  referenceType?: string;
  referenceId?: string;
  from?: string;
  to?: string;
};
const include = {
  warehouse: { select: { name: true, branchId: true } },
  variant: {
    select: { sku: true, name: true, lowStockThreshold: true, product: { select: { name: true } } },
  },
} as const;

@Injectable()
export class InventoryReadsService {
  constructor(private readonly prisma: PrismaService) {}
  private where(
    actor: Actor,
    permission: 'inventory.balances.read' | 'inventory.movements.read',
    query: Pick<Query, 'q' | 'warehouseId' | 'variantId'>,
  ) {
    if (!actor.grants[permission]?.some((scope) => scope === 'ORG' || scope === 'BRANCH'))
      throw new ForbiddenException();
    const q = query.q?.trim();
    return {
      AND: [
        { organizationId: actor.organizationId, warehouse: scopeFilter(actor, permission) },
        ...(query.warehouseId ? [{ warehouseId: query.warehouseId }] : []),
        ...(query.variantId ? [{ variantId: query.variantId }] : []),
        ...(q
          ? [
              {
                variant: {
                  OR: [
                    { sku: { contains: q, mode: 'insensitive' as const } },
                    { name: { contains: q, mode: 'insensitive' as const } },
                    { product: { name: { contains: q, mode: 'insensitive' as const } } },
                  ],
                },
              },
            ]
          : []),
      ],
    };
  }
  async balances(actor: Actor, query: Query) {
    const where: Prisma.StockBalanceWhereInput = this.where(
      actor,
      'inventory.balances.read',
      query,
    );
    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.stockBalance.findMany({
          where,
          include,
          orderBy: [{ updatedAt: query.sortOrder }, { id: query.sortOrder }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        this.prisma.stockBalance.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return new ListResult(
      rows.map((row) => {
        const available = row.onHand.minus(row.reserved);
        return {
          id: row.id,
          warehouseId: row.warehouseId,
          warehouseName: row.warehouse.name,
          branchId: row.warehouse.branchId,
          variantId: row.variantId,
          sku: row.variant.sku,
          variantName: row.variant.name,
          productName: row.variant.product.name,
          onHand: row.onHand.toFixed(3),
          reserved: row.reserved.toFixed(3),
          available: available.toFixed(3),
          lowStockThreshold: row.variant.lowStockThreshold.toFixed(3),
          lowStock: available.lte(row.variant.lowStockThreshold),
          updatedAt: row.updatedAt.toISOString(),
        };
      }),
      { page: query.page, pageSize: query.pageSize, total },
    );
  }
  async movements(actor: Actor, query: MovementQuery) {
    let cursor: { id: string; createdAt: string } | undefined;
    if (query.cursor)
      try {
        if (!/^[A-Za-z0-9_-]{1,256}$/.test(query.cursor)) throw new Error('shape');
        cursor = z
          .object({ id: z.string().uuid(), createdAt: z.string().datetime() })
          .strict()
          .parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')));
      } catch {
        throw new BadRequestException('Cursor không hợp lệ');
      }
    if (
      (query.from && !Number.isFinite(new Date(query.from).valueOf())) ||
      (query.to && !Number.isFinite(new Date(query.to).valueOf())) ||
      (query.from && query.to && new Date(query.from) > new Date(query.to))
    )
      throw new BadRequestException('Khoảng thời gian không hợp lệ');
    const where: Prisma.StockMovementWhereInput = {
      AND: [
        this.where(actor, 'inventory.movements.read', query),
        ...(query.referenceType ? [{ referenceType: query.referenceType }] : []),
        ...(query.referenceId ? [{ referenceId: query.referenceId }] : []),
        ...(cursor
          ? [
              {
                OR: [
                  { createdAt: { lt: new Date(cursor.createdAt) } },
                  { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
                ],
              },
            ]
          : []),
        ...(query.from || query.to
          ? [
              {
                createdAt: {
                  ...(query.from ? { gte: new Date(query.from) } : {}),
                  ...(query.to ? { lte: new Date(query.to) } : {}),
                },
              },
            ]
          : []),
      ],
    };
    const rows = await this.prisma.stockMovement.findMany({
      where,
      include,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const last = rows.slice(0, query.limit).at(-1);
    return new ListResult(
      rows.slice(0, query.limit).map((row) => ({
        id: row.id,
        warehouseId: row.warehouseId,
        warehouseName: row.warehouse.name,
        branchId: row.warehouse.branchId,
        variantId: row.variantId,
        sku: row.variant.sku,
        variantName: row.variant.name,
        productName: row.variant.product.name,
        quantityDelta: row.quantityDelta.toFixed(3),
        unitCost: row.unitCost?.toFixed(6) ?? null,
        referenceType: row.referenceType,
        referenceId: row.referenceId,
        createdBy: row.createdBy,
        createdAt: row.createdAt.toISOString(),
      })),
      {
        nextCursor:
          rows.length > query.limit && last
            ? Buffer.from(
                JSON.stringify({ id: last.id, createdAt: last.createdAt.toISOString() }),
              ).toString('base64url')
            : null,
      },
    );
  }
}
