import type { Prisma } from '../../../generated/prisma/client';
import {
  PERMISSIONS,
  SYSTEM_ROLES,
  defaultGrants,
  type SystemRole,
} from '../domain/permission-catalog';

export async function seedPermissionCatalog(tx: Prisma.TransactionClient) {
  const permissions = new Map<string, string>();
  for (const [code, scopes] of Object.entries(PERMISSIONS)) {
    const permission = await tx.permission.upsert({
      where: { code },
      create: { code, allowedScopes: scopes.join(',') },
      update: { allowedScopes: scopes.join(',') },
    });
    permissions.set(code, permission.id);
  }
  return permissions;
}

export async function seedIam(tx: Prisma.TransactionClient, organizationId: string) {
  await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
  const permissions = await seedPermissionCatalog(tx);
  for (const [code, name] of Object.entries(SYSTEM_ROLES)) {
    const role = await tx.role.upsert({
      where: { organizationId_code: { organizationId, code } },
      create: { organizationId, code, name, isSystem: true },
      update: { name, isSystem: true },
    });
    await tx.rolePermission.deleteMany({ where: { roleId: role.id, organizationId } });
    await tx.rolePermission.createMany({
      data: defaultGrants(code as SystemRole).map((grant) => ({
        organizationId,
        roleId: role.id,
        permissionId: permissions.get(grant.code)!,
        scope: grant.scope,
      })),
    });
  }
}
