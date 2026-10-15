import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
export async function cleanupIam(prisma: PrismaService, organizationIds: string[]) {
  await prisma.$transaction(async (tx) => {
    const [database] = await tx.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
    if (!database?.name.endsWith('_test') || organizationIds.length === 0)
      throw new Error('Cleanup requires owned test fixtures');
    // Exclusive DDL lock and transaction keep the trigger enabled for every other connection.
    await tx.$executeRaw`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_immutable`;
    await tx.auditLog.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await tx.$executeRaw`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_immutable`;
    const families = await tx.refreshFamily.findMany({
      where: { organizationId: { in: organizationIds } },
      select: { id: true },
    });
    await tx.refreshSession.deleteMany({ where: { familyId: { in: families.map((f) => f.id) } } });
    await tx.refreshFamily.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await tx.userBranchAccess.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await tx.userRole.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await tx.rolePermission.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await tx.role.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await tx.idempotencyKey.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await tx.user.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await tx.branch.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await tx.organization.deleteMany({ where: { id: { in: organizationIds } } });
  });
}
