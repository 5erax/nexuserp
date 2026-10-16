import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, SalesOrder } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { withTransactionRetry } from '../../../infrastructure/prisma/transaction';
import { IdempotentCommand } from '../../../common/idempotency/command';
import { ListResult } from '../../../common/pagination';
import { nextSalesOrderNumber } from '../../../common/sales-order-number';
import { AuthService, type RequestAudit } from '../../iam/application/auth.service';
import { scopeFilter, type Actor } from '../../iam/application/access-scope';
import { AuditService } from '../../audit/application/audit.service';
import { WarehousesService } from '../../inventory/application/warehouses.service';
import { ReservationsService } from '../../inventory/application/reservations.service';
import { OrganizationService } from '../../iam/application/organization.service';
import { CatalogService } from '../../catalog/application/catalog.service';
import { CustomerDirectoryService } from '../../crm/application/customer-directory.service';
import { PaymentReadsService } from '../../finance/application/payment-reads.service';
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
const include = { items: { orderBy: { id: 'asc' as const } } } as const;
type Document = Prisma.SalesOrderGetPayload<{ include: typeof include }>;
const lineState = (item: Document['items'][number]) => ({
  variantId: item.variantId,
  sku: item.sku,
  productName: item.productName,
  quantity: item.quantity.toFixed(3),
  unitPrice: item.unitPrice.toFixed(0),
  lineTotal: item.lineTotal.toFixed(0),
  deliveredQuantity: item.deliveredQuantity.toFixed(3),
});
const summary = (doc: SalesOrder, itemCount: number, customerName: string) => ({
  id: doc.id,
  orderNumber: doc.orderNumber,
  status: doc.status,
  currency: doc.currency,
  branchId: doc.branchId,
  warehouseId: doc.warehouseId,
  customerId: doc.customerId,
  customerName,
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
const data = (doc: Document, customerName: string) => ({
  ...summary(doc, doc.items.length, customerName),
  items: doc.items.map((item) => ({
    id: item.id,
    ...lineState(item),
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
    private readonly reservations: ReservationsService,
    private readonly organization: OrganizationService,
    private readonly catalog: CatalogService,
    private readonly customers: CustomerDirectoryService,
    private readonly payments: PaymentReadsService,
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
                orderNumber: { contains: q, mode: 'insensitive' as const },
              },
            ]
          : []),
      ],
    };
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.salesOrder.findMany({
          where,
          include: { _count: { select: { items: true } } },
          orderBy: [{ createdAt: query.sortOrder }, { id: query.sortOrder }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        });
        const count = await tx.salesOrder.count({ where });
        const names = new Map(
          (
            await this.customers.names(
              tx,
              actor.organizationId,
              rows.map((row) => row.customerId),
            )
          ).map((row) => [row.id, row.name]),
        );
        return new ListResult(
          rows.map((row) => summary(row, row._count.items, names.get(row.customerId)!)),
          { page: query.page, pageSize: query.pageSize, total: count },
        );
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async detail(actor: Actor, id: string) {
    const doc = await this.prisma.salesOrder.findFirst({
      where: { AND: [this.scope(actor, 'sales.orders.read'), { id }] },
      include,
    });
    if (!doc) throw new NotFoundException();
    const [customer] = await this.customers.names(this.prisma, actor.organizationId, [
      doc.customerId,
    ]);
    return data(doc, customer!.name);
  }
  private async authorize(
    tx: Prisma.TransactionClient,
    actor: Actor,
    permission: Permission,
    target: { branchId: string } | { id: string },
  ) {
    const current = await this.auth.lockActor(tx, actor);
    if ('id' in target)
      await tx.$queryRaw`SELECT id FROM sales_orders WHERE organization_id = ${actor.organizationId}::uuid AND id = ${target.id}::uuid FOR UPDATE`;
    const scope = this.scope(current, permission);
    if ('id' in target) {
      if (
        !(await tx.salesOrder.findFirst({
          where: { AND: [scope, { id: target.id }] },
          select: { id: true },
        }))
      )
        throw new NotFoundException();
    } else {
      if (
        !current.grants[permission]?.includes('ORG') &&
        !current.branchIds.includes(target.branchId.toLowerCase())
      )
        throw new NotFoundException();
      await this.organization.lockBranch(tx, actor.organizationId, target.branchId);
    }
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
    const client = await this.customers.lockActive(
      tx,
      actor.organizationId,
      branchId,
      input.customerId,
    );
    const variants = await this.catalog.lockActiveVariants(tx, actor.organizationId, ids);
    const byId = new Map(variants.map((v) => [v.id, v]));
    const items = input.items.map((item, index) => {
      const variant = byId.get(ids[index]!)!;
      return {
        variantId: variant.id,
        quantity: item.quantity,
        sku: variant.sku,
        productName: variant.productName,
        unitPrice: variant.sellingPrice,
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
      customerName: client.name,
      customerId: input.customerId,
      note: input.note ?? null,
      discountType: discount.type,
      discountValue: discount.value,
      ...totals,
      items: { create: items.map((item, index) => ({ ...item, lineTotal: lineTotals[index]! })) },
    };
  }
  private async record(
    tx: Prisma.TransactionClient,
    actor: Actor,
    doc: Document,
    action: string,
    context: RequestAudit,
    before?: Document,
  ) {
    const header = (order: Document) => ({
      status: order.status,
      version: order.version,
      customerId: order.customerId,
      discountType: order.discountType,
      discountValue: order.discountValue.toFixed(order.discountType === 'PERCENT' ? 2 : 0),
      itemCount: order.items.length,
      subtotal: order.subtotal.toFixed(0),
      discountTotal: order.discountTotal.toFixed(0),
      grandTotal: order.grandTotal.toFixed(0),
    });
    const record = async (eventAction: string, changes: Prisma.InputJsonObject) => {
      await tx.orderEvent.create({
        data: {
          organizationId: actor.organizationId,
          orderId: doc.id,
          actorId: actor.id,
          action: eventAction,
          requestId: context.requestId,
          payload: changes,
        },
      });
      await this.audit.record(tx, {
        organizationId: actor.organizationId,
        branchId: doc.branchId,
        actorId: actor.id,
        action: eventAction,
        entityType: 'sales_order',
        entityId: doc.id,
        ...context,
        changes,
      });
    };
    await record(action, {
      ...(before ? { before: header(before) } : {}),
      after: header(doc),
    });
    if (!before) return;
    // Each side of a 2,000-character note can occupy 12 KiB once JSON-escaped.
    if (before.note !== doc.note) {
      await record('sales.order_note_updated', { before: { note: before.note } });
      await record('sales.order_note_updated', { after: { note: doc.note } });
    }
    const oldLines = new Map(before.items.map((item) => [item.variantId, lineState(item)]));
    const newLines = new Map(doc.items.map((item) => [item.variantId, lineState(item)]));
    let batch: Prisma.InputJsonValue[] = [];
    for (const id of [...new Set([...oldLines.keys(), ...newLines.keys()])].sort()) {
      const oldLine = oldLines.get(id) ?? null,
        newLine = newLines.get(id) ?? null;
      if (JSON.stringify(oldLine) === JSON.stringify(newLine)) continue;
      const change = { before: oldLine, after: newLine };
      // Leave space for jsonb's additional whitespace inside the 16 KiB database limit.
      if (
        batch.length &&
        Buffer.byteLength(JSON.stringify({ items: [...batch, change] })) > 12000
      ) {
        await record('sales.order_items_updated', { items: batch });
        batch = [];
      }
      batch.push(change);
    }
    if (batch.length) await record('sales.order_items_updated', { items: batch });
  }
  create(actor: Actor, input: Draft & { branchId: string }, context: RequestAudit) {
    return new IdempotentCommand(
      input,
      (tx) => this.authorize(tx, actor, 'sales.orders.create', { branchId: input.branchId }),
      async (tx) => {
        const warehouse = await this.warehouses.lockDefault(
          tx,
          actor.organizationId,
          input.branchId,
        );
        const { customerName, ...snapshot } = await this.snapshots(
          tx,
          actor,
          input.branchId,
          input,
        );
        const doc = await tx.salesOrder.create({
          data: {
            organizationId: actor.organizationId,
            branchId: input.branchId,
            warehouseId: warehouse.id,
            createdBy: actor.id,
            orderNumber: await nextSalesOrderNumber(
              tx,
              actor.organizationId,
              await this.organization.businessYear(tx, actor.organizationId),
            ),
            ...snapshot,
          },
          include,
        });
        await this.record(tx, actor, doc, 'sales.order_created', context);
        return data(doc, customerName);
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
          hasPayments: await this.payments.hasForOrder(tx, actor.organizationId, id),
          hasPostedShipment: Boolean(
            await tx.shipment.findFirst({
              where: { organizationId: actor.organizationId, orderId: id, status: 'POSTED' },
              select: { id: true },
            }),
          ),
          hasReservations: await this.reservations.hasForOrder(tx, actor.organizationId, id),
        });
      } catch (error) {
        if (error instanceof OrderRuleError) throw conflict(error.code, error.message);
        throw error;
      }
      if (before.version !== input.version)
        throw conflict('ORDER_VERSION_CONFLICT', 'Đơn đã được người khác sửa, hãy tải lại');
      const { customerName, ...snapshot } = await this.snapshots(tx, actor, before.branchId, {
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
      await this.record(tx, actor, doc, 'sales.order_updated', context, before);
      return data(doc, customerName);
    });
  }
}
