import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { AuditService } from '../../audit/application/audit.service';
import { IamAdminPolicy } from './admin-policy.service';
import { AuthService, type RequestAudit } from './auth.service';
import { PasswordService } from './password.service';
import type { Actor } from '../domain/access-scope';
import { ListResult } from '../../../common/pagination';
const ADMIN_CODES = ['BUSINESS_OWNER', 'SYSTEM_ADMINISTRATOR'];
const userInclude = {
  roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
  branches: { include: { branch: true } },
} satisfies Prisma.UserInclude;
type UserRecord = Prisma.UserGetPayload<{ include: typeof userInclude }>;
export type UserInput = {
  email: string;
  displayName: string;
  temporaryPassword: string;
  roleIds: string[];
  branchIds: string[];
  status?: 'ACTIVE' | 'INACTIVE' | 'LOCKED';
};
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: IamAdminPolicy,
    private readonly auth: AuthService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}
  private where(actor: Actor): Prisma.UserWhereInput {
    if (!actor.grants['iam.users.read']?.some((scope) => scope === 'ORG' || scope === 'BRANCH'))
      return { organizationId: actor.organizationId, id: { in: [] } };
    return {
      organizationId: actor.organizationId,
      ...(actor.grants['iam.users.read']?.includes('ORG')
        ? {}
        : {
            branches: { some: { branchId: { in: actor.branchIds }, branch: { status: 'ACTIVE' } } },
          }),
    };
  }
  private present(user: UserRecord, actor: Actor) {
    const org =
      actor.grants['iam.users.read']?.includes('ORG') ||
      actor.grants['iam.users.manage']?.includes('ORG');
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
      createdAt: user.createdAt.toISOString(),
      roles: user.roles.map(({ role }) => ({ id: role.id, code: role.code, name: role.name })),
      branchIds: user.branches
        .filter((access) => org || actor.branchIds.includes(access.branchId))
        .map((access) => access.branchId),
    };
  }
  async list(
    actor: Actor,
    query: {
      page: number;
      pageSize: number;
      q?: string;
      status?: string;
      branchId?: string;
      sortBy: 'createdAt' | 'email' | 'displayName';
      sortOrder: 'asc' | 'desc';
    },
  ) {
    const where: Prisma.UserWhereInput = {
      AND: [
        this.where(actor),
        ...(query.branchId &&
        !actor.grants['iam.users.read']?.includes('ORG') &&
        !actor.branchIds.includes(query.branchId)
          ? [{ id: { in: [] as string[] } }]
          : []),
        ...(query.status ? [{ status: query.status }] : []),
        ...(query.branchId ? [{ branches: { some: { branchId: query.branchId } } }] : []),
        ...(query.q
          ? [
              {
                OR: [
                  { email: { contains: query.q.trim(), mode: 'insensitive' as const } },
                  { displayName: { contains: query.q.trim(), mode: 'insensitive' as const } },
                ],
              },
            ]
          : []),
      ],
    };
    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.user.findMany({
          where,
          include: userInclude,
          orderBy: [{ [query.sortBy]: query.sortOrder }, { id: query.sortOrder }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        this.prisma.user.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return new ListResult(
      rows.map((user) => this.present(user, actor)),
      { page: query.page, pageSize: query.pageSize, total },
    );
  }
  async detail(actor: Actor, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { AND: [this.where(actor), { id }] },
      include: userInclude,
    });
    if (!user) throw new NotFoundException();
    return this.present(user, actor);
  }
  private unique(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw new ConflictException({
        code: 'DUPLICATE_EMAIL',
        message: 'Email đã được sử dụng trong tổ chức',
      });
    throw error;
  }
  private branchRequirement(
    status: string,
    roles: Awaited<ReturnType<IamAdminPolicy['roles']>>,
    branchIds: string[],
  ) {
    if (
      status === 'ACTIVE' &&
      roles.some((role) => role.permissions.some((p) => p.scope !== 'ORG')) &&
      branchIds.length === 0
    )
      throw new BadRequestException(
        'Tài khoản có quyền theo chi nhánh cần ít nhất một chi nhánh hoạt động',
      );
  }
  async create(actor: Actor, input: UserInput, context: RequestAudit) {
    const passwordHash = await this.passwords.hash(input.temporaryPassword);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await this.policy.lock(tx, actor, 'iam.users.manage');
        const roles = await this.policy.roles(tx, current, input.roleIds);
        await this.policy.branches(tx, actor.organizationId, input.branchIds);
        this.branchRequirement(input.status ?? 'ACTIVE', roles, input.branchIds);
        const user = await tx.user.create({
          data: {
            organizationId: actor.organizationId,
            email: input.email.trim().toLowerCase(),
            displayName: input.displayName,
            status: input.status ?? 'ACTIVE',
            passwordHash,
            mustChangePassword: true,
          },
        });
        await tx.userRole.createMany({
          data: input.roleIds.map((roleId) => ({
            organizationId: actor.organizationId,
            userId: user.id,
            roleId,
          })),
        });
        await tx.userBranchAccess.createMany({
          data: input.branchIds.map((branchId) => ({
            organizationId: actor.organizationId,
            userId: user.id,
            branchId,
          })),
        });
        await this.audit.record(tx, {
          organizationId: actor.organizationId,
          actorId: actor.id,
          action: 'iam.user_created',
          entityType: 'user',
          entityId: user.id,
          ...context,
          changes: {
            after: {
              email: user.email,
              displayName: user.displayName,
              status: user.status,
              roleIds: input.roleIds,
              branchIds: input.branchIds,
            },
          },
        });
        return this.present(
          await tx.user.findUniqueOrThrow({ where: { id: user.id }, include: userInclude }),
          current,
        );
      });
    } catch (error) {
      return this.unique(error);
    }
  }
  async update(actor: Actor, id: string, input: Partial<UserInput>, context: RequestAudit) {
    const email = input.email?.trim().toLowerCase();
    const passwordHash = input.temporaryPassword
      ? await this.passwords.hash(input.temporaryPassword)
      : undefined;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const currentActor = await this.policy.lock(tx, actor, 'iam.users.manage');
        await tx.$queryRaw`SELECT id FROM users WHERE id=${id}::uuid AND organization_id=${actor.organizationId}::uuid FOR NO KEY UPDATE`;
        const user = await tx.user.findFirst({
          where: { id, organizationId: actor.organizationId },
          include: userInclude,
        });
        if (!user) throw new NotFoundException();
        this.policy.grants(
          currentActor,
          user.roles.flatMap(({ role }) =>
            role.permissions.map((p) => ({
              code: p.permission.code,
              scope: p.scope as 'ORG' | 'BRANCH' | 'OWN',
            })),
          ),
        );
        const roleIds = input.roleIds ?? user.roles.map((r) => r.roleId);
        const branchIds =
          input.branchIds ??
          user.branches.filter((b) => b.branch.status === 'ACTIVE').map((b) => b.branchId);
        const roles = await this.policy.roles(tx, currentActor, roleIds);
        await this.policy.branches(tx, actor.organizationId, branchIds);
        const status = input.status ?? user.status;
        this.branchRequirement(status, roles, branchIds);
        const wasAdmin =
          user.status === 'ACTIVE' &&
          user.roles.some(({ role }) => role.isSystem && ADMIN_CODES.includes(role.code));
        const willAdmin =
          status === 'ACTIVE' &&
          roles.some((role) => role.isSystem && ADMIN_CODES.includes(role.code));
        if (
          wasAdmin &&
          !willAdmin &&
          (await tx.user.count({
            where: {
              organizationId: actor.organizationId,
              id: { not: id },
              status: 'ACTIVE',
              roles: { some: { role: { isSystem: true, code: { in: ADMIN_CODES } } } },
            },
          })) === 0
        )
          throw new ConflictException({
            code: 'LAST_ADMIN_REQUIRED',
            message: 'Tổ chức phải còn ít nhất một quản trị viên hoạt động',
          });
        if (passwordHash || status !== user.status || (email && email !== user.email))
          await this.auth.revokeUserSessions(tx, id);
        await tx.user.update({
          where: { id },
          data: {
            email,
            displayName: input.displayName,
            status: input.status,
            ...(passwordHash ? { passwordHash, mustChangePassword: true } : {}),
          },
        });
        if (input.roleIds) {
          await tx.userRole.deleteMany({
            where: { userId: id, organizationId: actor.organizationId },
          });
          await tx.userRole.createMany({
            data: roleIds.map((roleId) => ({
              organizationId: actor.organizationId,
              userId: id,
              roleId,
            })),
          });
        }
        if (input.branchIds) {
          await tx.userBranchAccess.deleteMany({
            where: { userId: id, organizationId: actor.organizationId },
          });
          await tx.userBranchAccess.createMany({
            data: branchIds.map((branchId) => ({
              organizationId: actor.organizationId,
              userId: id,
              branchId,
            })),
          });
        }
        const updated = await tx.user.findUniqueOrThrow({ where: { id }, include: userInclude });
        await this.audit.record(tx, {
          organizationId: actor.organizationId,
          actorId: actor.id,
          action: passwordHash ? 'iam.password_reset' : 'iam.user_updated',
          entityType: 'user',
          entityId: id,
          ...context,
          changes: {
            before: this.present(user, currentActor),
            after: this.present(updated, currentActor),
          },
        });
        return this.present(updated, currentActor);
      });
    } catch (error) {
      return this.unique(error);
    }
  }
}
