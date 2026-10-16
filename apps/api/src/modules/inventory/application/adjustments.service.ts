import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type StockAdjustment } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { ENVIRONMENT, type Environment } from '../../../config/environment';
import { IdempotentCommand } from '../../../common/idempotency/command';
import { ListResult } from '../../../common/pagination';
import { AuthService, type RequestAudit } from '../../iam/application/auth.service';
import { scopeFilter, type Actor } from '../../iam/application/access-scope';
import { AuditService } from '../../audit/application/audit.service';
import { WarehousesService } from './warehouses.service';
import { StockLedgerService } from './stock-ledger.service';

type Permission =
  | 'inventory.adjustments.create'
  | 'inventory.adjustments.approve'
  | 'inventory.adjustments.post';
type Input = {
  warehouseId: string;
  kind: 'OPENING' | 'ADJUSTMENT';
  reason: string;
  items: { variantId: string; quantityDelta: string; unitCost?: string | null }[];
};
type Query = {
  page: number;
  pageSize: number;
  sortOrder: 'asc' | 'desc';
  q?: string;
  warehouseId?: string;
  kind?: string;
  status?: string;
};
const warehouse = { select: { name: true, branchId: true } } as const;
const include = {
  warehouse,
  items: {
    include: { variant: { select: { sku: true, name: true } } },
    orderBy: { id: 'asc' as const },
  },
} as const;
type Document = Prisma.StockAdjustmentGetPayload<{ include: typeof include }>;
const state = (doc: StockAdjustment) => ({
  status: doc.status,
  approvedBy: doc.approvedBy,
  approvedAt: doc.approvedAt?.toISOString() ?? null,
  postedAt: doc.postedAt?.toISOString() ?? null,
  decisionReason: doc.decisionReason,
});
const summary = (
  doc: StockAdjustment & { warehouse: { name: string; branchId: string } },
  itemCount: number,
) => ({
  id: doc.id,
  warehouseId: doc.warehouseId,
  warehouseName: doc.warehouse.name,
  branchId: doc.warehouse.branchId,
  kind: doc.kind,
  reason: doc.reason,
  createdBy: doc.createdBy,
  approvalThreshold: doc.approvalThreshold.toFixed(3),
  itemCount,
  ...state(doc),
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});
const total = (doc: Document) =>
  doc.items.reduce((sum, item) => sum.plus(item.quantityDelta.abs()), new Prisma.Decimal(0));
const data = (doc: Document) => ({
  ...summary(doc, doc.items.length),
  totalAbsoluteQuantity: total(doc).toFixed(3),
  requiresApproval: total(doc).gt(doc.approvalThreshold),
  items: doc.items.map((item) => ({
    id: item.id,
    variantId: item.variantId,
    sku: item.variant.sku,
    variantName: item.variant.name,
    quantityDelta: item.quantityDelta.toFixed(3),
    unitCost: item.unitCost?.toFixed(6) ?? null,
  })),
});
const conflict = (code: string, message: string) => new ConflictException({ code, message });

@Injectable()
export class AdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly warehouses: WarehousesService,
    private readonly ledger: StockLedgerService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}
  private scope(actor: Actor, permission: Permission | 'inventory.movements.read') {
    if (!actor.grants[permission]?.some((scope) => scope === 'ORG' || scope === 'BRANCH'))
      throw new ForbiddenException();
    return { organizationId: actor.organizationId, warehouse: scopeFilter(actor, permission) };
  }
  async list(actor: Actor, query: Query) {
    const q = query.q?.trim();
    const where: Prisma.StockAdjustmentWhereInput = {
      AND: [
        this.scope(actor, 'inventory.movements.read'),
        ...(query.warehouseId ? [{ warehouseId: query.warehouseId }] : []),
        ...(query.kind ? [{ kind: query.kind }] : []),
        ...(query.status ? [{ status: query.status }] : []),
        ...(q
          ? [
              {
                OR: [
                  { reason: { contains: q, mode: 'insensitive' as const } },
                  {
                    items: {
                      some: { variant: { sku: { contains: q, mode: 'insensitive' as const } } },
                    },
                  },
                ],
              },
            ]
          : []),
      ],
    };
    const [rows, count] = await this.prisma.$transaction(
      [
        this.prisma.stockAdjustment.findMany({
          where,
          include: { warehouse, _count: { select: { items: true } } },
          orderBy: [{ createdAt: query.sortOrder }, { id: query.sortOrder }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        this.prisma.stockAdjustment.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return new ListResult(
      rows.map((doc) => summary(doc, doc._count.items)),
      { page: query.page, pageSize: query.pageSize, total: count },
    );
  }
  async detail(actor: Actor, id: string) {
    const doc = await this.prisma.stockAdjustment.findFirst({
      where: { AND: [this.scope(actor, 'inventory.movements.read'), { id }] },
      include,
    });
    if (!doc) throw new NotFoundException();
    return data(doc);
  }
  private async authorize(
    tx: Prisma.TransactionClient,
    actor: Actor,
    permission: Permission,
    target: { id: string } | { warehouseId: string },
  ) {
    // Shared organization lock freezes grants/branch assignments while business commands can run in parallel.
    await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${actor.organizationId}::uuid FOR SHARE`;
    if ('id' in target)
      await tx.$queryRaw`SELECT id FROM stock_adjustments WHERE organization_id = ${actor.organizationId}::uuid AND id = ${target.id}::uuid FOR UPDATE`;
    const current = await this.auth.actorForFamily(tx, {
      sub: actor.id,
      organizationId: actor.organizationId,
      familyId: actor.familyId,
    });
    if (current.mustChangePassword) throw new ForbiddenException();
    const scope = this.scope(current, permission);
    if ('id' in target) {
      const doc = await tx.stockAdjustment.findFirst({
        where: { AND: [scope, { id: target.id }] },
        select: { createdBy: true },
      });
      if (!doc) throw new NotFoundException();
    } else if (
      !(await tx.warehouse.findFirst({
        where: { AND: [scope.warehouse, { id: target.warehouseId }] },
        select: { id: true },
      }))
    )
      throw new NotFoundException();
  }
  private async load(tx: Prisma.TransactionClient, organizationId: string, id: string) {
    return tx.stockAdjustment.findFirstOrThrow({ where: { organizationId, id }, include });
  }
  private record(
    tx: Prisma.TransactionClient,
    actor: Actor,
    doc: Document,
    action: string,
    context: RequestAudit,
    changes: Prisma.InputJsonValue,
  ) {
    return this.audit.record(tx, {
      organizationId: actor.organizationId,
      branchId: doc.warehouse.branchId,
      actorId: actor.id,
      action,
      entityType: 'stock_adjustment',
      entityId: doc.id,
      ...context,
      changes,
    });
  }
  create(actor: Actor, input: Input, context: RequestAudit) {
    return new IdempotentCommand(
      input,
      (tx) =>
        this.authorize(tx, actor, 'inventory.adjustments.create', {
          warehouseId: input.warehouseId,
        }),
      async (tx) => {
        const ids = input.items.map((item) => item.variantId.toLowerCase());
        if (
          !ids.length ||
          ids.length > 100 ||
          new Set(ids).size !== ids.length ||
          input.items.some(
            (item) =>
              new Prisma.Decimal(item.quantityDelta).isZero() ||
              (input.kind === 'OPENING' && new Prisma.Decimal(item.quantityDelta).isNegative()) ||
              (new Prisma.Decimal(item.quantityDelta).isNegative() && item.unitCost != null),
          )
        )
          throw new BadRequestException();
        await this.warehouses.lockActive(tx, actor.organizationId, input.warehouseId);
        if (
          (await tx.productVariant.count({
            where: { organizationId: actor.organizationId, id: { in: ids } },
          })) !== ids.length
        )
          throw new NotFoundException();
        const doc = await tx.stockAdjustment.create({
          data: {
            organizationId: actor.organizationId,
            warehouseId: input.warehouseId,
            kind: input.kind,
            reason: input.reason,
            createdBy: actor.id,
            approvalThreshold: this.environment.INVENTORY_APPROVAL_THRESHOLD,
            items: {
              create: input.items.map((item) => ({
                variantId: item.variantId,
                quantityDelta: item.quantityDelta,
                unitCost: item.unitCost ?? null,
              })),
            },
          },
          include,
        });
        const result = data(doc);
        await this.record(tx, actor, doc, 'inventory.adjustment_created', context, {
          after: result,
        });
        return result;
      },
    );
  }
  post(actor: Actor, id: string, context: RequestAudit) {
    return new IdempotentCommand(
      {},
      (tx) => this.authorize(tx, actor, 'inventory.adjustments.post', { id }),
      async (tx) => {
        const before = await this.load(tx, actor.organizationId, id);
        if (!before.items.length)
          throw conflict('INVALID_STATE_TRANSITION', 'Phiếu chưa có dòng hàng');
        if (before.status === 'PENDING_APPROVAL')
          throw conflict('APPROVAL_REQUIRED', 'Phiếu đang chờ người khác phê duyệt');
        if (!['DRAFT', 'APPROVED'].includes(before.status))
          throw conflict('INVALID_STATE_TRANSITION', 'Trạng thái phiếu không cho phép ghi sổ');
        await this.warehouses.lockActive(tx, actor.organizationId, before.warehouseId);
        if (before.status === 'DRAFT' && total(before).gt(before.approvalThreshold)) {
          const pending = await tx.stockAdjustment.update({
            where: { id },
            data: { status: 'PENDING_APPROVAL' },
            include,
          });
          await this.record(
            tx,
            actor,
            pending,
            'inventory.adjustment_approval_requested',
            context,
            { before: state(before), after: state(pending) },
          );
          return data(pending);
        }
        const balances = await tx.$queryRaw<
          { id: string; variantId: string }[]
        >(Prisma.sql`SELECT id, variant_id AS "variantId" FROM stock_balances
        WHERE organization_id = ${actor.organizationId}::uuid AND warehouse_id = ${before.warehouseId}::uuid AND variant_id IN (${Prisma.join(before.items.map((item) => Prisma.sql`${item.variantId}::uuid`))}) ORDER BY id FOR NO KEY UPDATE`);
        const order = new Map(balances.map((balance, index) => [balance.variantId, index]));
        const items = [...before.items].sort(
          (a, b) =>
            (order.get(a.variantId) ?? balances.length) -
              (order.get(b.variantId) ?? balances.length) || a.variantId.localeCompare(b.variantId),
        );
        for (const item of items)
          await this.ledger.post(tx, {
            organizationId: actor.organizationId,
            warehouseId: before.warehouseId,
            variantId: item.variantId,
            createdBy: actor.id,
            referenceId: id,
            referenceType:
              before.kind === 'OPENING'
                ? 'OPENING'
                : item.quantityDelta.isPositive()
                  ? 'ADJUSTMENT_IN'
                  : 'ADJUSTMENT_OUT',
            quantityDelta: item.quantityDelta.toFixed(3),
            unitCost: item.unitCost?.toFixed(6) ?? null,
          });
        const posted = await tx.stockAdjustment.update({
          where: { id },
          data: { status: 'POSTED', postedAt: new Date() },
          include,
        });
        await this.record(tx, actor, posted, 'inventory.adjustment_posted', context, {
          before: state(before),
          after: state(posted),
        });
        return data(posted);
      },
    );
  }
  approve(actor: Actor, id: string, context: RequestAudit) {
    return this.decide(actor, id, 'approve', undefined, context);
  }
  reject(actor: Actor, id: string, reason: string, context: RequestAudit) {
    return this.decide(actor, id, 'reject', reason, context);
  }
  cancel(actor: Actor, id: string, context: RequestAudit) {
    return this.decide(actor, id, 'cancel', undefined, context);
  }
  private decide(
    actor: Actor,
    id: string,
    action: 'approve' | 'reject' | 'cancel',
    reason: string | undefined,
    context: RequestAudit,
  ) {
    return new IdempotentCommand(
      reason === undefined ? {} : { reason },
      (tx) =>
        this.authorize(
          tx,
          actor,
          action === 'cancel' ? 'inventory.adjustments.create' : 'inventory.adjustments.approve',
          { id },
        ),
      async (tx) => {
        const before = await this.load(tx, actor.organizationId, id);
        const allowed =
          action === 'cancel' ? ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'] : ['PENDING_APPROVAL'];
        if (!allowed.includes(before.status))
          throw conflict(
            'INVALID_STATE_TRANSITION',
            'Trạng thái phiếu không cho phép quyết định này',
          );
        if (action === 'approve' && before.createdBy === actor.id)
          throw conflict('SELF_APPROVAL_FORBIDDEN', 'Người tạo không được tự phê duyệt phiếu');
        if (action === 'approve')
          await this.warehouses.lockActive(tx, actor.organizationId, before.warehouseId);
        const doc = await tx.stockAdjustment.update({
          where: { id },
          data:
            action === 'approve'
              ? { status: 'APPROVED', approvedBy: actor.id, approvedAt: new Date() }
              : action === 'reject'
                ? { status: 'REJECTED', decisionReason: reason }
                : { status: 'CANCELLED' },
          include,
        });
        await this.record(
          tx,
          actor,
          doc,
          action === 'approve'
            ? 'inventory.adjustment_approved'
            : action === 'reject'
              ? 'inventory.adjustment_rejected'
              : 'inventory.adjustment_cancelled',
          context,
          { before: state(before), after: state(doc) },
        );
        return data(doc);
      },
    );
  }
}
