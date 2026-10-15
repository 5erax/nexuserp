import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { ListResult } from '../../../common/pagination';
import { AuditService } from '../../audit/application/audit.service';
import type { Actor } from '../domain/access-scope';
import { IamAdminPolicy } from './admin-policy.service';
import type { RequestAudit } from './auth.service';
type BranchInput = { code: string; name: string; status?: 'ACTIVE' | 'INACTIVE' };
@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: IamAdminPolicy,
    private readonly audit: AuditService,
  ) {}
  private branchWhere(actor: Actor): Prisma.BranchWhereInput {
    return {
      organizationId: actor.organizationId,
      ...(actor.grants['iam.branches.read']?.includes('ORG')
        ? {}
        : {
            id: {
              in: actor.grants['iam.branches.read']?.includes('BRANCH') ? actor.branchIds : [],
            },
          }),
    };
  }
  async branches(
    actor: Actor,
    query: {
      page: number;
      pageSize: number;
      q?: string;
      status?: string;
      sortOrder: 'asc' | 'desc';
    },
  ) {
    const where: Prisma.BranchWhereInput = {
      AND: [
        this.branchWhere(actor),
        ...(query.status ? [{ status: query.status }] : []),
        ...(query.q
          ? [
              {
                OR: [
                  { code: { contains: query.q, mode: 'insensitive' as const } },
                  { name: { contains: query.q, mode: 'insensitive' as const } },
                ],
              },
            ]
          : []),
      ],
    };
    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.branch.findMany({
          where,
          orderBy: [{ createdAt: query.sortOrder }, { id: query.sortOrder }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        this.prisma.branch.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return new ListResult(
      rows.map((b) => ({ id: b.id, code: b.code, name: b.name, status: b.status })),
      { page: query.page, pageSize: query.pageSize, total },
    );
  }
  async branch(actor: Actor, id: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { AND: [this.branchWhere(actor), { id }] },
    });
    if (!branch) throw new NotFoundException();
    return { id: branch.id, code: branch.code, name: branch.name, status: branch.status };
  }
  private conflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw new ConflictException({ code: 'DUPLICATE_CODE', message: 'Mã chi nhánh đã tồn tại' });
    throw error;
  }
  async createBranch(actor: Actor, input: BranchInput, context: RequestAudit) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.policy.lock(tx, actor, 'iam.branches.manage');
        const branch = await tx.branch.create({
          data: {
            organizationId: actor.organizationId,
            code: input.code,
            name: input.name,
            status: input.status ?? 'ACTIVE',
          },
        });
        const result = {
          id: branch.id,
          code: branch.code,
          name: branch.name,
          status: branch.status,
        };
        await this.audit.record(tx, {
          organizationId: actor.organizationId,
          branchId: branch.id,
          actorId: actor.id,
          action: 'iam.branch_created',
          entityType: 'branch',
          entityId: branch.id,
          ...context,
          changes: { after: result },
        });
        return result;
      });
    } catch (error) {
      return this.conflict(error);
    }
  }
  async updateBranch(actor: Actor, id: string, input: Partial<BranchInput>, context: RequestAudit) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.policy.lock(tx, actor, 'iam.branches.manage');
        const branch = await tx.branch.findFirst({
          where: { id, organizationId: actor.organizationId },
        });
        if (!branch) throw new NotFoundException();
        if (branch.status === 'ACTIVE' && input.status === 'INACTIVE') {
          const members = await tx.user.findMany({
            where: {
              organizationId: actor.organizationId,
              status: 'ACTIVE',
              branches: { some: { branchId: id } },
            },
            include: {
              branches: { include: { branch: true } },
              roles: { include: { role: { include: { permissions: true } } } },
            },
          });
          if (
            members.some(
              (user) =>
                user.roles.some((r) => r.role.permissions.some((p) => p.scope !== 'ORG')) &&
                !user.branches.some(
                  (access) => access.branchId !== id && access.branch.status === 'ACTIVE',
                ),
            )
          )
            throw new ConflictException({
              code: 'BRANCH_HAS_ACTIVE_USERS',
              message:
                'Chuyển nhân viên đang hoạt động sang chi nhánh khác trước khi ngừng chi nhánh',
            });
        }
        const updated = await tx.branch.update({ where: { id }, data: input });
        const result = {
          id: updated.id,
          code: updated.code,
          name: updated.name,
          status: updated.status,
        };
        await this.audit.record(tx, {
          organizationId: actor.organizationId,
          branchId: id,
          actorId: actor.id,
          action: 'iam.branch_updated',
          entityType: 'branch',
          entityId: id,
          ...context,
          changes: {
            before: { code: branch.code, name: branch.name, status: branch.status },
            after: result,
          },
        });
        return result;
      });
    } catch (error) {
      return this.conflict(error);
    }
  }
  async profile(actor: Actor) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: actor.organizationId },
    });
    return {
      id: org.id,
      code: org.code,
      name: org.name,
      currency: org.currency,
      timezone: org.timezone,
    };
  }
  async updateProfile(
    actor: Actor,
    input: { name?: string; currency?: string; timezone?: string },
    context: RequestAudit,
  ) {
    if (input.timezone)
      try {
        new Intl.DateTimeFormat('en', { timeZone: input.timezone }).format();
      } catch {
        throw new BadRequestException('Múi giờ không hợp lệ');
      }
    return this.prisma.$transaction(async (tx) => {
      await this.policy.lock(tx, actor, 'iam.organization.update');
      const before = await tx.organization.findUniqueOrThrow({
        where: { id: actor.organizationId },
      });
      const after = await tx.organization.update({
        where: { id: actor.organizationId },
        data: input,
      });
      await this.audit.record(tx, {
        organizationId: actor.organizationId,
        actorId: actor.id,
        action: 'iam.organization_updated',
        entityType: 'organization',
        entityId: actor.organizationId,
        ...context,
        changes: {
          before: { name: before.name, currency: before.currency, timezone: before.timezone },
          after: { name: after.name, currency: after.currency, timezone: after.timezone },
        },
      });
      return {
        id: after.id,
        code: after.code,
        name: after.name,
        currency: after.currency,
        timezone: after.timezone,
      };
    });
  }
}
