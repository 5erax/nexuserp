import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { parseEnvironment } from '../src/config/environment';
import { AuditService, redactAudit } from '../src/modules/audit/application/audit.service';
describe('IAM-005 audit persistence', () => {
  let prisma: PrismaService;
  const organizationId = randomUUID();
  let audit: AuditService;
  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL?.split('?')[0]?.endsWith('_test'))
      throw new Error('Dedicated test database required');
    prisma = new PrismaService(
      parseEnvironment({ ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL }),
    );
    audit = new AuditService(prisma);
    await prisma.organization.create({
      data: { id: organizationId, code: 'T-' + organizationId.slice(0, 8), name: 'Audit fixture' },
    });
  });
  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
  });
  const input = {
    organizationId,
    action: 'test.created',
    entityType: 'test',
    requestId: 'audit-test',
  };
  it('writes in the caller transaction and rolls back with business data', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.organization.update({ where: { id: organizationId }, data: { name: 'Changed' } });
        await audit.record(tx, {
          ...input,
          changes: {
            before: { passwordHash: 'private' },
            after: { token: 'private', name: 'Visible' },
          },
        });
        const row = await tx.auditLog.findFirstOrThrow({ where: { organizationId } });
        expect(JSON.stringify(row.changes)).not.toContain('private');
        expect(JSON.stringify(row.changes)).toContain('Visible');
        throw new Error('rollback-fixture');
      }),
    ).rejects.toThrow('rollback-fixture');
    expect(await prisma.auditLog.count({ where: { organizationId } })).toBe(0);
    expect(
      (await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })).name,
    ).toBe('Audit fixture');
  });
  it.each(['update', 'delete'] as const)('rejects %s at database level', async (action) => {
    await expect(
      prisma.$transaction(async (tx) => {
        const row = await audit.record(tx, input);
        if (action === 'update')
          await tx.auditLog.update({ where: { id: row.id }, data: { action: 'tampered' } });
        else await tx.auditLog.delete({ where: { id: row.id } });
      }),
    ).rejects.toThrow();
    expect(await prisma.auditLog.count({ where: { organizationId } })).toBe(0);
  });
  it('redacts nested arrays and secret fields automatically', () => {
    expect(
      redactAudit({ items: [{ authorization: 'private', password: 'private', name: 'Kept' }] }),
    ).toEqual({ items: [{ authorization: '[REDACTED]', password: '[REDACTED]', name: 'Kept' }] });
  });
});
