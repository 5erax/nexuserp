import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type SalesOrder } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { withTransactionRetry } from '../../../infrastructure/prisma/transaction';
import { IdempotentCommand } from '../../../common/idempotency/command';
import { ListResult } from '../../../common/pagination';
import { AuthService, type RequestAudit } from '../../iam/application/auth.service';
import { scopeFilter, type Actor } from '../../iam/application/access-scope';
import { AuditService } from '../../audit/application/audit.service';
import { WarehousesService } from '../../inventory/application/warehouses.service';
import { calculatePrice, type Discount } from './price-calculator';
import { OrderStatePolicy } from '../domain/order-state-policy';
import { OrderRuleError } from '../domain/order-rule-error';

type Draft = {
  customerId: string;
  items: { variantId: string; quantity: string }[];
  discount?: Discount;
  note?: string | null;
};
type Permission = 'sales.orders.read' | 'sales.orders.create' | 'sales.orders.update';
type Query = {
  page: number;
  pageSize: number;
  sortOrder: 'asc' | 'desc';
  q?: string;
  status?: string;
  branchId?: string;
  customerId?: string;
  createdFrom?: string;
  createdTo?: string;
};
const customer = { select: { name: true } } as const;
const include = { customer, items: { orderBy: { id: 'asc' as const } } } as const;
type Document = Prisma.SalesOrderGetPayload<{ include: typeof include }>;
const summary = (doc: SalesOrder & { customer: { name: string } }, itemCount: number) => ({
  id: doc.id,
  orderNumber: doc.orderNumber,
  status: doc.status,
  currency: doc.currency,
  branchId: doc.branchId,
  warehouseId: doc.warehouseId,
  customerId: doc.customerId,
  customerName: doc.customer.name,
  createdBy: doc.createdBy,
  subtotal: doc.subtotal.toFixed(0),
  discountType: doc.discountType,
  discountValue: doc.discountValue.toFixed(doc.discountType === 'PERCENT' ? 2 : 0),
  discountTotal: doc.discountTotal.toFixed(0),
  taxTotal: doc.taxTotal.toFixed(0),
  grandTotal: doc.grandTotal.toFixed(0),
  note: doc.note,
  version: doc.version,
  itemCount,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});
const data = (doc: Document) => ({
  ...summary(doc, doc.items.length),
  items: doc.items.map((item) => ({
    id: item.id,
    variantId: item.variantId,
    sku: item.sku,
    productName: item.productName,
    quantity: item.quantity.toFixed(3),
    unitPrice: item.unitPrice.toFixed(0),
    lineTotal: item.lineTotal.toFixed(0),
    deliveredQuantity: item.deliveredQuantity.toFixed(3),
  })),
});
const conflict = (code: string, message: string) => new ConflictException({ code, message });

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly warehouses: WarehousesService,
  ) {}
  private scope(actor: Actor, permission: Permission) {
    if (!actor.grants[permission]?.length) throw new ForbiddenException();
    return scopeFilter(actor, permission);
  }
  async list(actor: Actor, query: Query) {
    if (
      query.createdFrom &&
      query.createdTo &&
      new Date(query.createdFrom) > new Date(query.createdTo)
    )
      throw new BadRequestException();
    const q = query.q?.trim();
    const where: Prisma.SalesOrderWhereInput = {
      AND: [
        this.scope(actor, 'sales.orders.read'),
        ...(query.branchId ? [{ branchId: query.branchId }] : []),
        ...(query.customerId ? [{ customerId: query.customerId }] : []),
        ...(query.status ? [{ status: query.status }] : []),
        ...(query.createdFrom || query.createdTo
          ? [
              {
                createdAt: {
                  ...(query.createdFrom ? { gte: new Date(query.createdFrom) } : {}),
                  ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
                },
              },
            ]
          : []),
        ...(q
          ? [
              {
                OR: [
                  { orderNumber: { contains: q, mode: 'insensitive' as const } },
                  { customer: { name: { contains: q, mode: 'insensitive' as const } } },
                ],
              },
            ]
          : []),
      ],
    };
    const [rows, count] = await this.prisma.$transaction(
      [
        this.prisma.salesOrder.findMany({
          where,
          include: { customer, _count: { select: { items: true } } },
          orderBy: [{ createdAt: query.sortOrder }, { id: query.sortOrder }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        this.prisma.salesOrder.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return new ListResult(
      rows.map((row) => summary(row, row._count.items)),
      { page: query.page, pageSize: query.pageSize, total: count },
    );
  }
  async detail(actor: Actor, id: string) {
    const doc = await this.prisma.salesOrder.findFirst({
      where: { AND: [this.scope(actor, 'sales.orders.read'), { id }] },
      include,
    });
    if (!doc) throw new NotFoundException();
    return data(doc);
  }
  private async authorize(
    tx: Prisma.TransactionClient,
    actor: Actor,
    permission: Permission,
    target: { branchId: string } | { id: string },
  ) {
    await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${actor.organizationId}::uuid FOR SHARE`;
    if ('id' in target)
      await tx.$queryRaw`SELECT id FROM sales_orders WHERE organization_id = ${actor.organizationId}::uuid AND id = ${target.id}::uuid FOR UPDATE`;
    const current = await this.auth.actorForFamily(tx, {
      sub: actor.id,
      organizationId: actor.organizationId,
      familyId: actor.familyId,
    });
    if (current.mustChangePassword) throw new ForbiddenException();
    const scope = this.scope(current, permission);
    if ('id' in target) {
      if (
        !(await tx.salesOrder.findFirst({
          where: { AND: [scope, { id: target.id }] },
          select: { id: true },
        }))
      )
        throw new NotFoundException();
    } else if (
      (!current.grants[permission]?.includes('ORG') &&
        !current.branchIds.includes(target.branchId.toLowerCase())) ||
      !(await tx.branch.findFirst({
        where: { organizationId: actor.organizationId, id: target.branchId },
        select: { id: true },
      }))
    )
      throw new NotFoundException();
  }
  private async snapshots(
    tx: Prisma.TransactionClient,
    actor: Actor,
    branchId: string,
    input: Draft,
  ) {
    const ids = input.items.map((item) => item.variantId.toLowerCase());
    if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length)
      throw new BadRequestException({
        code: 'INVALID_ORDER_ITEMS',
        message: 'Đơn phải có từ 1 đến 100 biến thể khác nhau',
      });
    const [client] = await tx.$queryRaw<
      { id: string; status: string }[]
    >`SELECT id,status FROM customers WHERE organization_id = ${actor.organizationId}::uuid AND branch_id = ${branchId}::uuid AND id = ${input.customerId}::uuid FOR SHARE`;
    if (!client) throw new NotFoundException();
    if (client.status !== 'ACTIVE')
      throw conflict('CUSTOMER_INACTIVE', 'Khách hàng đã ngừng hoạt động');
    // Catalog writes lock these rows, so every line snapshots one committed catalog version.
    await tx.$queryRaw(
      Prisma.sql`SELECT v.id FROM product_variants v JOIN products p ON p.organization_id = v.organization_id AND p.id = v.product_id WHERE v.organization_id = ${actor.organizationId}::uuid AND v.id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY p.id,v.id FOR SHARE OF p,v`,
    );
    const variants = await tx.productVariant.findMany({
      where: { organizationId: actor.organizationId, id: { in: ids } },
      include: { product: { select: { name: true, status: true } } },
    });
    if (variants.length !== ids.length) throw new NotFoundException();
    if (variants.some((v) => v.status !== 'ACTIVE' || v.product.status !== 'ACTIVE'))
      throw conflict('PRODUCT_INACTIVE', 'Sản phẩm hoặc biến thể đã ngừng hoạt động');
    const byId = new Map(variants.map((v) => [v.id, v]));
    const items = input.items.map((item, index) => {
      const variant = byId.get(ids[index]!)!;
      return {
        variantId: variant.id,
        quantity: item.quantity,
        sku: variant.sku,
        productName: variant.product.name,
        unitPrice: variant.sellingPrice.toFixed(0),
      };
    });
    const discount = input.discount ?? { type: 'NONE', value: '0' };
    let price: ReturnType<typeof calculatePrice>;
    try {
      price = calculatePrice(items, discount);
    } catch (error) {
      if (error instanceof OrderRuleError)
        throw new BadRequestException({ code: error.code, message: error.message });
      throw error;
    }
    const { lineTotals, ...totals } = price;
    return {
      customerId: input.customerId,
      note: input.note ?? null,
      discountType: discount.type,
      discountValue: discount.value,
      ...totals,
      items: { create: items.map((item, index) => ({ ...item, lineTotal: lineTotals[index]! })) },
    };
  }
  private async nextNumber(tx: Prisma.TransactionClient, organizationId: string) {
    const [sequence] = await tx.$queryRaw<
      { value: bigint; year: number }[]
    >`INSERT INTO document_sequences (organization_id,kind,year,next_value)
      SELECT id,'SO',EXTRACT(YEAR FROM CURRENT_TIMESTAMP AT TIME ZONE timezone)::integer,2 FROM organizations WHERE id = ${organizationId}::uuid
      ON CONFLICT (organization_id,kind,year) DO UPDATE SET next_value = document_sequences.next_value + 1
      WHERE document_sequences.next_value < 9223372036854775807
      RETURNING next_value - 1 AS value,year`;
    if (!sequence) throw conflict('ORDER_NUMBER_EXHAUSTED', 'Đã hết miền số đơn hàng');
    return `SO-${sequence.year}-${sequence.value.toString().padStart(6, '0')}`;
  }
  private async record(
    tx: Prisma.TransactionClient,
    actor: Actor,
    doc: Document,
    action: string,
    context: RequestAudit,
  ) {
    const payload = {
      status: doc.status,
      version: doc.version,
      itemCount: doc.items.length,
      subtotal: doc.subtotal.toFixed(0),
      discountTotal: doc.discountTotal.toFixed(0),
      grandTotal: doc.grandTotal.toFixed(0),
    };
    await tx.orderEvent.create({
      data: {
        organizationId: actor.organizationId,
        orderId: doc.id,
        actorId: actor.id,
        action,
        requestId: context.requestId,
        payload,
      },
    });
    await this.audit.record(tx, {
      organizationId: actor.organizationId,
      branchId: doc.branchId,
      actorId: actor.id,
      action,
      entityType: 'sales_order',
      entityId: doc.id,
      ...context,
      changes: { after: payload },
    });
  }
  create(actor: Actor, input: Draft & { branchId: string }, context: RequestAudit) {
    return new IdempotentCommand(
      input,
      (tx) => this.authorize(tx, actor, 'sales.orders.create', { branchId: input.branchId }),
      async (tx) => {
        const warehouse = await tx.warehouse.findFirst({
          where: {
            organizationId: actor.organizationId,
            branchId: input.branchId,
            isDefault: true,
            status: 'ACTIVE',
          },
          select: { id: true },
        });
        if (!warehouse)
          throw conflict(
            'BRANCH_WAREHOUSE_NOT_CONFIGURED',
            'Chi nhánh chưa có kho mặc định hoạt động',
          );
        await this.warehouses.lockActive(tx, actor.organizationId, warehouse.id);
        const snapshot = await this.snapshots(tx, actor, input.branchId, input);
        const doc = await tx.salesOrder.create({
          data: {
            organizationId: actor.organizationId,
            branchId: input.branchId,
            warehouseId: warehouse.id,
            createdBy: actor.id,
            orderNumber: await this.nextNumber(tx, actor.organizationId),
            ...snapshot,
          },
          include,
        });
        await this.record(tx, actor, doc, 'sales.order_created', context);
        return data(doc);
      },
    );
  }
  async update(
    actor: Actor,
    id: string,
    input: Partial<Draft> & { version: number },
    context: RequestAudit,
  ) {
    if (Object.entries(input).every(([key, value]) => key === 'version' || value === undefined))
      throw new BadRequestException();
    return withTransactionRetry(this.prisma, async (tx) => {
      await this.authorize(tx, actor, 'sales.orders.update', { id });
      const before = await tx.salesOrder.findUniqueOrThrow({ where: { id }, include });
      try {
        OrderStatePolicy.transition(before.status, 'UPDATE', {
          hasPayments: Boolean(
            await tx.payment.findFirst({
              where: { organizationId: actor.organizationId, salesOrderId: id },
              select: { id: true },
            }),
          ),
          hasPostedShipment: Boolean(
            await tx.shipment.findFirst({
              where: { organizationId: actor.organizationId, orderId: id, status: 'POSTED' },
              select: { id: true },
            }),
          ),
          hasReservations: Boolean(
            await tx.stockReservation.findFirst({
              where: { organizationId: actor.organizationId, orderItem: { orderId: id } },
              select: { id: true },
            }),
          ),
        });
      } catch (error) {
        if (error instanceof OrderRuleError) throw conflict(error.code, error.message);
        throw error;
      }
      if (before.version !== input.version)
        throw conflict('ORDER_VERSION_CONFLICT', 'Đơn đã được người khác sửa, hãy tải lại');
      await this.warehouses.lockActive(tx, actor.organizationId, before.warehouseId);
      const snapshot = await this.snapshots(tx, actor, before.branchId, {
        customerId: input.customerId ?? before.customerId,
        items:
          input.items ??
          before.items.map((item) => ({
            variantId: item.variantId,
            quantity: item.quantity.toFixed(3),
          })),
        discount: input.discount ?? {
          type: before.discountType as Discount['type'],
          value: before.discountValue.toFixed(before.discountType === 'PERCENT' ? 2 : 0),
        },
        note: input.note === undefined ? before.note : input.note,
      });
      await tx.salesOrderItem.deleteMany({
        where: { organizationId: actor.organizationId, orderId: id },
      });
      const doc = await tx.salesOrder.update({
        where: { id },
        data: { ...snapshot, version: { increment: 1 } },
        include,
      });
      await this.record(tx, actor, doc, 'sales.order_updated', context);
      return data(doc);
    });
  }
}
