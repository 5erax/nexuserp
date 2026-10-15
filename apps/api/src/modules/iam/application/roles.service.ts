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
import { SYSTEM_ROLES } from '../domain/permission-catalog';
import { IamAdminPolicy, type Grant } from './admin-policy.service';
import type { RequestAudit } from './auth.service';
const include = { permissions: { include: { permission: true } } } satisfies Prisma.RoleInclude;
type RoleRecord = Prisma.RoleGetPayload<{ include: typeof include }>;
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: IamAdminPolicy,
    private readonly audit: AuditService,
  ) {}
  private present(role: RoleRecord) {
    return {
      id: role.id,
      code: role.code,
      name: role.name,
      isSystem: role.isSystem,
      permissions: role.permissions.map((p) => ({ code: p.permission.code, scope: p.scope })),
      createdAt: role.createdAt.toISOString(),
    };
  }
  async list(
    actor: Actor,
    query: { page: number; pageSize: number; q?: string; sortOrder: 'asc' | 'desc' },
  ) {
    const where: Prisma.RoleWhereInput = {
      organizationId: actor.organizationId,
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { code: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.role.findMany({
          where,
          include,
          orderBy: [{ createdAt: query.sortOrder }, { id: query.sortOrder }],
          take: query.pageSize,
          skip: (query.page - 1) * query.pageSize,
        }),
        this.prisma.role.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return new ListResult(
      rows.map((r) => this.present(r)),
      { page: query.page, pageSize: query.pageSize, total },
    );
  }
  async permissions() {
    return (await this.prisma.permission.findMany({ orderBy: { code: 'asc' } })).map((p) => ({
      id: p.id,
      code: p.code,
      allowedScopes: p.allowedScopes.split(','),
    }));
  }
  private async assign(
    tx: Prisma.TransactionClient,
    actor: Actor,
    roleId: string,
    grants: Grant[],
  ) {
    if (new Set(grants.map((p) => p.code)).size !== grants.length)
      throw new BadRequestException('Permission bị trùng');
    this.policy.grants(actor, grants);
    const permissions = await tx.permission.findMany({
      where: { code: { in: grants.map((p) => p.code) } },
    });
    if (permissions.length !== grants.length)
      throw new BadRequestException('Permission không hợp lệ');
    await tx.rolePermission.deleteMany({ where: { organizationId: actor.organizationId, roleId } });
    await tx.rolePermission.createMany({
      data: grants.map((grant) => ({
        organizationId: actor.organizationId,
        roleId,
        permissionId: permissions.find((p) => p.code === grant.code)!.id,
        scope: grant.scope,
      })),
    });
  }
  async create(
    actor: Actor,
    input: { code: string; name: string; permissions: Grant[] },
    context: RequestAudit,
  ) {
    if (Object.hasOwn(SYSTEM_ROLES, input.code))
      throw new ConflictException({
        code: 'SYSTEM_ROLE_IMMUTABLE',
        message: 'Mã vai trò hệ thống được bảo vệ',
      });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await this.policy.lock(tx, actor, 'iam.roles.manage');
        const role = await tx.role.create({
          data: { organizationId: actor.organizationId, code: input.code, name: input.name },
        });
        await this.assign(tx, current, role.id, input.permissions);
        const result = this.present(
          await tx.role.findUniqueOrThrow({ where: { id: role.id }, include }),
        );
        await this.audit.record(tx, {
          organizationId: actor.organizationId,
          actorId: actor.id,
          action: 'iam.role_created',
          entityType: 'role',
          entityId: role.id,
          ...context,
          changes: { after: result },
        });
        return result;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException({ code: 'DUPLICATE_CODE', message: 'Mã vai trò đã tồn tại' });
      throw error;
    }
  }
  async update(actor: Actor, id: string, grants: Grant[], context: RequestAudit) {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.policy.lock(tx, actor, 'iam.roles.manage');
      const role = await tx.role.findFirst({
        where: { id, organizationId: actor.organizationId },
        include,
      });
      if (!role) throw new NotFoundException();
      if (role.isSystem)
        throw new ConflictException({
          code: 'SYSTEM_ROLE_IMMUTABLE',
          message: 'Không thể sửa quyền vai trò hệ thống',
        });
      await this.assign(tx, current, id, grants);
      const result = this.present(await tx.role.findUniqueOrThrow({ where: { id }, include }));
      await this.audit.record(tx, {
        organizationId: actor.organizationId,
        actorId: actor.id,
        action: 'iam.role_permissions_updated',
        entityType: 'role',
        entityId: id,
        ...context,
        changes: { before: this.present(role), after: result },
      });
      return result;
    });
  }
}
