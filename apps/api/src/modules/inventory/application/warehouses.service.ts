import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Warehouse } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { withTransactionRetry } from '../../../infrastructure/prisma/transaction';
import { ListResult } from '../../../common/pagination';
import { IdempotentCommand } from '../../../common/idempotency/command';
import { AuthService, type RequestAudit } from '../../iam/application/auth.service';
import { scopeFilter, type Actor } from '../../iam/application/access-scope';
import { AuditService } from '../../audit/application/audit.service';

type Input = {
  branchId: string;
  code: string;
  name: string;
  status?: 'ACTIVE' | 'INACTIVE';
  isDefault?: boolean;
};
type Query = {
  page: number;
  pageSize: number;
  q?: string;
  branchId?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  sortOrder: 'asc' | 'desc';
};
const include = { branch: { select: { name: true } } } as const;
const data = (row: Warehouse & { branch: { name: string } }) => ({
  id: row.id,
  branchId: row.branchId,
  branchName: row.branch.name,
  code: row.code,
  name: row.name,
  status: row.status,
  isDefault: row.isDefault,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

@Injectable()
export class WarehousesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}
  private where(actor: Actor) {
    if (
      !actor.grants['inventory.warehouses.read']?.some(
        (scope) => scope === 'ORG' || scope === 'BRANCH',
      )
    )
      throw new ForbiddenException();
    return scopeFilter(actor, 'inventory.warehouses.read');
  }
  async list(actor: Actor, query: Query) {
    const q = query.q?.trim();
    const where: Prisma.WarehouseWhereInput = {
      AND: [
        this.where(actor),
        ...(query.branchId ? [{ branchId: query.branchId }] : []),
        ...(query.status ? [{ status: query.status }] : []),
        ...(q
          ? [
              {
                OR: [
                  { code: { contains: q, mode: 'insensitive' as const } },
                  { name: { contains: q, mode: 'insensitive' as const } },
                ],
              },
            ]
          : []),
      ],
    };
    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.warehouse.findMany({
          where,
          include,
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          orderBy: [{ createdAt: query.sortOrder }, { id: query.sortOrder }],
        }),
        this.prisma.warehouse.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return new ListResult(rows.map(data), { page: query.page, pageSize: query.pageSize, total });
  }
  async detail(actor: Actor, id: string) {
    const row = await this.prisma.warehouse.findFirst({
      where: { AND: [this.where(actor), { id }] },
      include,
    });
    if (!row) throw new NotFoundException();
    return data(row);
  }
  private async manage(tx: Prisma.TransactionClient, actor: Actor) {
    await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${actor.organizationId}::uuid FOR NO KEY UPDATE`;
    const current = await this.auth.actorForFamily(tx, {
      sub: actor.id,
      organizationId: actor.organizationId,
      familyId: actor.familyId,
    });
    if (
      current.mustChangePassword ||
      !current.grants['inventory.warehouses.manage']?.includes('ORG')
    )
      throw new ForbiddenException();
  }
  private async branch(tx: Prisma.TransactionClient, organizationId: string, id: string) {
    const row = await tx.branch.findFirst({ where: { organizationId, id } });
    if (!row) throw new NotFoundException();
    if (row.status !== 'ACTIVE')
      throw new ConflictException({
        code: 'BRANCH_INACTIVE',
        message: 'Chi nhánh đã ngừng hoạt động',
      });
  }
  private async clearDefault(
    tx: Prisma.TransactionClient,
    actor: Actor,
    branchId: string,
    exceptId: string,
    context: RequestAudit,
  ) {
    const previous = await tx.warehouse.findFirst({
      where: {
        organizationId: actor.organizationId,
        branchId,
        id: { not: exceptId },
        status: 'ACTIVE',
        isDefault: true,
      },
    });
    if (!previous) return;
    await tx.warehouse.update({ where: { id: previous.id }, data: { isDefault: false } });
    await this.audit.record(tx, {
      organizationId: actor.organizationId,
      branchId,
      actorId: actor.id,
      action: 'inventory.warehouse_default_cleared',
      entityType: 'warehouse',
      entityId: previous.id,
      ...context,
      changes: { before: { isDefault: true }, after: { isDefault: false } },
    });
  }
  private duplicate(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw new ConflictException({
        code: 'DUPLICATE_CODE',
        message: 'Mã kho đã tồn tại hoặc cấu hình mặc định xung đột',
      });
    throw error;
  }
  create(actor: Actor, input: Input, context: RequestAudit) {
    return new IdempotentCommand(
      input,
      (tx) => this.manage(tx, actor),
      async (tx) => {
        if (input.status === 'INACTIVE' && input.isDefault) throw new BadRequestException();
        await this.branch(tx, actor.organizationId, input.branchId);
        const id = randomUUID();
        if (input.isDefault) await this.clearDefault(tx, actor, input.branchId, id, context);
        try {
          const row = await tx.warehouse.create({
            data: { id, organizationId: actor.organizationId, ...input },
            include,
          });
          const result = data(row);
          await this.audit.record(tx, {
            organizationId: actor.organizationId,
            branchId: row.branchId,
            actorId: actor.id,
            action: 'inventory.warehouse_created',
            entityType: 'warehouse',
            entityId: id,
            ...context,
            changes: { after: result },
          });
          return result;
        } catch (error) {
          return this.duplicate(error);
        }
      },
    );
  }
  update(actor: Actor, id: string, input: Partial<Omit<Input, 'branchId'>>, context: RequestAudit) {
    if (!Object.keys(input).length || (input.status === 'INACTIVE' && input.isDefault))
      throw new BadRequestException();
    return withTransactionRetry(this.prisma, async (tx) => {
      await this.manage(tx, actor);
      await tx.$queryRaw`SELECT id FROM warehouses WHERE organization_id = ${actor.organizationId}::uuid AND id = ${id}::uuid FOR UPDATE`;
      const before = await tx.warehouse.findFirst({
        where: { organizationId: actor.organizationId, id },
        include,
      });
      if (!before) throw new NotFoundException();
      const status = input.status ?? before.status,
        isDefault = status === 'INACTIVE' ? false : (input.isDefault ?? before.isDefault);
      if (status === 'ACTIVE') await this.branch(tx, actor.organizationId, before.branchId);
      if (before.status === 'ACTIVE' && status === 'INACTIVE') {
        // shortcut: add the CONFIRMED-order guard when Sales schema lands in #58.
        if (
          await tx.stockReservation.findFirst({
            where: {
              organizationId: actor.organizationId,
              status: 'ACTIVE',
              balance: { warehouseId: id },
            },
            select: { id: true },
          })
        )
          throw new ConflictException({
            code: 'WAREHOUSE_HAS_RESERVATIONS',
            message: 'Kho còn hàng đang giữ, chưa thể ngừng hoạt động',
          });
      }
      if (isDefault) await this.clearDefault(tx, actor, before.branchId, id, context);
      try {
        const row = await tx.warehouse.update({
          where: { id },
          data: { code: input.code, name: input.name, status, isDefault },
          include,
        });
        const result = data(row);
        await this.audit.record(tx, {
          organizationId: actor.organizationId,
          branchId: row.branchId,
          actorId: actor.id,
          action: 'inventory.warehouse_updated',
          entityType: 'warehouse',
          entityId: id,
          ...context,
          changes: { before: data(before), after: result },
        });
        return result;
      } catch (error) {
        return this.duplicate(error);
      }
    });
  }
  async lockActive(tx: Prisma.TransactionClient, organizationId: string, id: string) {
    if (typeof Reflect.get(tx, '$connect') === 'function')
      throw new Error('Warehouse locking requires a caller transaction');
    if (!(await tx.warehouse.findFirst({ where: { organizationId, id }, select: { id: true } })))
      throw new NotFoundException();
    const [row] = await tx.$queryRaw<
      { id: string; branchId: string }[]
    >`SELECT w.id, w.branch_id AS "branchId"
      FROM warehouses w JOIN branches b ON b.organization_id = w.organization_id AND b.id = w.branch_id
      WHERE w.organization_id = ${organizationId}::uuid AND w.id = ${id}::uuid AND w.status = 'ACTIVE' AND b.status = 'ACTIVE'
      FOR SHARE OF w, b`;
    if (!row)
      throw new ConflictException({
        code: 'WAREHOUSE_INACTIVE',
        message: 'Kho hoặc chi nhánh đã ngừng hoạt động',
      });
    return row;
  }
}
