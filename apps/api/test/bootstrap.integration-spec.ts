import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { parseEnvironment } from '../src/config/environment';
import { bootstrapIam } from '../src/modules/iam/infrastructure/bootstrap-iam';
import { PasswordService } from '../src/modules/iam/application/password.service';
import { cleanupIam } from './fixtures/cleanup-iam';
it('bootstraps a new organization atomically without overwriting an existing owner or exposing secrets', async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL required');
  const prisma = new PrismaService(
    parseEnvironment({ ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL }),
  );
  const input = {
    organizationCode: 'T-' + randomUUID().slice(0, 8),
    organizationName: 'Bootstrap fixture',
    email: 'OWNER@example.test',
    password: 'temporary-bootstrap-password',
  };
  const ids: string[] = [];
  try {
    await expect(bootstrapIam(prisma, { ...input, password: 'short' })).rejects.toThrow();
    expect(await prisma.organization.count({ where: { code: input.organizationCode } })).toBe(0);
    const created = await bootstrapIam(prisma, input);
    ids.push(created.organizationId);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: created.userId },
      include: { roles: { include: { role: true } } },
    });
    expect(user.mustChangePassword).toBe(true);
    expect(user.email).toBe('owner@example.test');
    expect(await new PasswordService().verify(input.password, user.passwordHash)).toBe(true);
    expect(user.roles[0]?.role.code).toBe('BUSINESS_OWNER');
    await expect(
      bootstrapIam(prisma, { ...input, password: 'replacement-must-not-work' }),
    ).rejects.toThrow();
    expect(await prisma.user.count({ where: { organizationId: created.organizationId } })).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { organizationId: created.organizationId },
    });
    expect(JSON.stringify(audit)).not.toContain(input.password);
    expect(JSON.stringify(created)).not.toMatch(/password|hash|token/i);
  } finally {
    await cleanupIam(prisma, ids);
    await prisma.$disconnect();
  }
});
