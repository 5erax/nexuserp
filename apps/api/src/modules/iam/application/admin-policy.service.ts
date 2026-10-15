import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { AuthService } from './auth.service';
import { canGrant, type Actor } from '../domain/access-scope';
import { PERMISSIONS, type PermissionCode, type Scope } from '../domain/permission-catalog';
export type Grant = { code: string; scope: Scope };
@Injectable()
export class IamAdminPolicy {
  constructor(private readonly auth: AuthService) {}
  async lock(tx: Prisma.TransactionClient, actor: Actor, permission: PermissionCode) {
    await tx.$queryRaw`SELECT id FROM organizations WHERE id=${actor.organizationId}::uuid FOR NO KEY UPDATE`;
    const current = await this.auth.actorForFamily(tx, {
      sub: actor.id,
      organizationId: actor.organizationId,
      familyId: actor.familyId,
    });
    if (current.mustChangePassword || !current.grants[permission]?.includes('ORG'))
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Bạn không có quyền quản trị thao tác này',
      });
    return current;
  }
  grants(actor: Actor, permissions: Grant[]) {
    for (const permission of permissions) {
      const allowed = Object.hasOwn(PERMISSIONS, permission.code)
        ? (PERMISSIONS[permission.code as PermissionCode] as readonly string[])
        : undefined;
      if (!allowed?.includes(permission.scope))
        throw new BadRequestException('Permission hoặc phạm vi không hợp lệ');
      if (!canGrant(actor, permission.code, permission.scope))
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'Không thể cấp quyền vượt phạm vi của bạn',
        });
    }
  }
  async roles(tx: Prisma.TransactionClient, actor: Actor, roleIds: string[]) {
    const roles = await tx.role.findMany({
      where: { organizationId: actor.organizationId, id: { in: roleIds } },
      include: { permissions: { include: { permission: true } } },
    });
    if (roles.length !== roleIds.length) throw new BadRequestException('Vai trò không hợp lệ');
    for (const role of roles)
      this.grants(
        actor,
        role.permissions.map((p) => ({ code: p.permission.code, scope: p.scope as Scope })),
      );
    return roles;
  }
  async branches(tx: Prisma.TransactionClient, organizationId: string, branchIds: string[]) {
    const count = await tx.branch.count({
      where: { organizationId, id: { in: branchIds }, status: 'ACTIVE' },
    });
    if (count !== branchIds.length)
      throw new BadRequestException('Chi nhánh không hợp lệ hoặc đã ngừng hoạt động');
  }
}
