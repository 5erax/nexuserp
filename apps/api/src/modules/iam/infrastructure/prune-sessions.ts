import type { PrismaService } from '../../../infrastructure/prisma/prisma.service';
export async function pruneExpiredSessions(prisma: PrismaService) {
  const families = await prisma.refreshFamily.findMany({
    where: { expiresAt: { lt: new Date() } },
    orderBy: { expiresAt: 'asc' },
    take: 100,
    select: { id: true },
  });
  let removed = 0;
  for (const { id } of families)
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM refresh_families WHERE id=${id}::uuid FOR UPDATE`;
      const family = await tx.refreshFamily.findUnique({ where: { id } });
      const now = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now;
      if (!family || family.expiresAt >= now) return;
      await tx.refreshSession.deleteMany({ where: { familyId: id } });
      await tx.refreshFamily.delete({ where: { id } });
      removed++;
    });
  return removed;
}
