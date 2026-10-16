import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Customer } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { withTransactionRetry } from '../../../infrastructure/prisma/transaction';
import { IdempotentCommand } from '../../../common/idempotency/command';
import { ListResult } from '../../../common/pagination';
import { AuthService, type RequestAudit } from '../../iam/application/auth.service';
import { scopeFilter, type Actor } from '../../iam/application/access-scope';
import { AuditService } from '../../audit/application/audit.service';
import { OrdersService } from '../../sales/application/orders.service';
import { OrganizationService } from '../../iam/application/organization.service';

type Input = {
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  status?: 'ACTIVE' | 'INACTIVE';
};
type Permission = 'crm.customers.read' | 'crm.customers.create' | 'crm.customers.update';
type Query = {
  page: number;
  pageSize: number;
  sortOrder: 'asc' | 'desc';
  q?: string;
  branchId?: string;
  status?: string;
  sortBy: 'name' | 'createdAt';
};
const data = (row: Customer) => ({
  id: row.id,
  branchId: row.branchId,
  createdBy: row.createdBy,
  name: row.name,
  email: row.email,
  phone: row.phone,
  address: row.address,
  notes: row.notes,
  status: row.status,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
const auditData = (row: Customer) => ({
  name: row.name,
  email: row.email,
  phone: row.phone,
  status: row.status,
});

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly sales: OrdersService,
    private readonly organization: OrganizationService,
  ) {}
  private scope(actor: Actor, permission: Permission) {
    if (!actor.grants[permission]?.some((scope) => scope === 'ORG' || scope === 'BRANCH'))
      throw new ForbiddenException();
    return scopeFilter(actor, permission);
  }
  async list(actor: Actor, query: Query) {
    const q = query.q?.trim();
    const where: Prisma.CustomerWhereInput = {
      AND: [
        this.scope(actor, 'crm.customers.read'),
        ...(query.branchId ? [{ branchId: query.branchId }] : []),
        ...(query.status ? [{ status: query.status }] : []),
        ...(q
          ? [
              {
                OR: ['name', 'email', 'phone'].map((field) => ({
                  [field]: { contains: q, mode: 'insensitive' },
                })),
              },
            ]
          : []),
      ],
    };
    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.customer.findMany({
          where,
          orderBy: [{ [query.sortBy]: query.sortOrder }, { id: query.sortOrder }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        this.prisma.customer.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return new ListResult(rows.map(data), { page: query.page, pageSize: query.pageSize, total });
  }
  private async find(actor: Actor, id: string) {
    const row = await this.prisma.customer.findFirst({
      where: { AND: [this.scope(actor, 'crm.customers.read'), { id }] },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  async detail(actor: Actor, id: string) {
    return data(await this.find(actor, id));
  }
  async orders(actor: Actor, id: string, query: Omit<Query, 'sortBy'>) {
    await this.find(actor, id);
    const result = await this.sales.list(actor, { ...query, customerId: id });
    return new ListResult(
      result.items.map(({ id: orderId, orderNumber, status, currency, grandTotal, createdAt }) => ({
        id: orderId,
        orderNumber,
        status,
        currency,
        grandTotal,
        createdAt,
      })),
      result.meta,
    );
  }
  private async authorize(
    tx: Prisma.TransactionClient,
    actor: Actor,
    permission: Permission,
    target: { id: string } | { branchId: string },
  ) {
    const current = await this.auth.lockActor(tx, actor);
    if ('id' in target)
      await tx.$queryRaw`SELECT id FROM customers WHERE organization_id = ${actor.organizationId}::uuid AND id = ${target.id}::uuid FOR NO KEY UPDATE`;
    const scope = this.scope(current, permission);
    if ('id' in target) {
      if (
        !(await tx.customer.findFirst({
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
  private record(
    tx: Prisma.TransactionClient,
    actor: Actor,
    after: Customer,
    context: RequestAudit,
    before?: Customer,
    changedFields: string[] = [],
  ) {
    return this.audit.record(tx, {
      organizationId: actor.organizationId,
      branchId: after.branchId,
      actorId: actor.id,
      action: before ? 'crm.customer_updated' : 'crm.customer_created',
      entityType: 'customer',
      entityId: after.id,
      ...context,
      // Keep private free text out of the immutable audit; field names still identify address/notes edits.
      changes: {
        ...(before ? { before: auditData(before) } : {}),
        after: auditData(after),
        changedFields,
      },
    });
  }
  create(actor: Actor, input: Input & { branchId: string }, context: RequestAudit) {
    return new IdempotentCommand(
      input,
      (tx) => this.authorize(tx, actor, 'crm.customers.create', { branchId: input.branchId }),
      async (tx) => {
        const branch = await this.organization.lockBranch(tx, actor.organizationId, input.branchId);
        if (branch.status !== 'ACTIVE')
          throw new ConflictException({
            code: 'BRANCH_INACTIVE',
            message: 'Chi nhánh đã ngừng hoạt động',
          });
        const row = await tx.customer.create({
          data: { ...input, organizationId: actor.organizationId, createdBy: actor.id },
        });
        await this.record(tx, actor, row, context, undefined, Object.keys(input));
        return data(row);
      },
    );
  }
  async update(actor: Actor, id: string, input: Partial<Input>, context: RequestAudit) {
    const changedFields = Object.keys(input).filter(
      (key) => input[key as keyof Input] !== undefined,
    );
    if (!changedFields.length) throw new BadRequestException();
    return withTransactionRetry(this.prisma, async (tx) => {
      await this.authorize(tx, actor, 'crm.customers.update', { id });
      const before = await tx.customer.findUniqueOrThrow({ where: { id } });
      const row = await tx.customer.update({ where: { id }, data: input });
      await this.record(tx, actor, row, context, before, changedFields);
      return data(row);
    });
  }
}
