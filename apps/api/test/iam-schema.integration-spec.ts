import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { parseEnvironment } from '../src/config/environment';
import { seedIam } from '../src/modules/iam/infrastructure/seed-permissions';
import { PERMISSIONS } from '../src/modules/iam/domain/permission-catalog';

// Structurally valid hash fixture; authentication tests use the actual Argon2 implementation.
const passwordHash = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdGZpeHR1cmU$aGFzaGZpeHR1cmU';
describe('IAM schema on PostgreSQL', () => {
  let prisma: PrismaService;
  const orgs = [randomUUID(), randomUUID()];
  const userId = randomUUID();
  const familyIds: string[] = [];
  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL?.split('?')[0]?.endsWith('_test'))
      throw new Error('Dedicated test database required');
    prisma = new PrismaService(
      parseEnvironment({ ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL }),
    );
    for (const id of orgs)
      await prisma.organization.create({
        data: { id, code: 'T-' + id.slice(0, 8), name: 'IAM fixture' },
      });
    await prisma.user.create({
      data: {
        id: userId,
        organizationId: orgs[0]!,
        email: 'admin@example.test',
        displayName: 'Admin',
        passwordHash,
      },
    });
  });
  afterAll(async () => {
    if (!prisma) return;
    await prisma.refreshSession.deleteMany({ where: { familyId: { in: familyIds } } });
    await prisma.refreshFamily.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.userRole.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.userBranchAccess.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.rolePermission.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.role.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.user.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.branch.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
    await prisma.$disconnect();
  });
  it('IAM-001 rejects duplicate and unnormalized email, but allows another organization', async () => {
    const data = {
      organizationId: orgs[0]!,
      email: 'admin@example.test',
      displayName: 'User',
      passwordHash,
    };
    await expect(prisma.user.create({ data })).rejects.toThrow();
    await expect(
      prisma.user.create({ data: { ...data, email: 'ADMIN@example.test' } }),
    ).rejects.toThrow();
    await prisma.user.create({ data: { ...data, organizationId: orgs[1]! } });
  });
  it('IAM-002 rejects invalid status and plaintext password', async () => {
    await expect(
      prisma.user.update({ where: { id: userId }, data: { status: 'UNKNOWN' } }),
    ).rejects.toThrow();
    await expect(
      prisma.user.update({ where: { id: userId }, data: { passwordHash: 'plaintext' } }),
    ).rejects.toThrow();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).status).toBe('ACTIVE');
  });
  it('IAM-003 seeds the exact catalog and system grants idempotently', async () => {
    await prisma.$transaction((tx) => seedIam(tx, orgs[0]!));
    const roles = await prisma.role.findMany({
      where: { organizationId: orgs[0] },
      include: { permissions: true },
      orderBy: { code: 'asc' },
    });
    await prisma.$transaction((tx) => seedIam(tx, orgs[0]!));
    const repeated = await prisma.role.findMany({
      where: { organizationId: orgs[0] },
      include: { permissions: true },
      orderBy: { code: 'asc' },
    });
    expect(repeated.map((r) => ({ id: r.id, grants: r.permissions.length }))).toEqual(
      roles.map((r) => ({ id: r.id, grants: r.permissions.length })),
    );
    expect(roles).toHaveLength(5);
    expect(
      await prisma.permission.count({ where: { code: { in: Object.keys(PERMISSIONS) } } }),
    ).toBe(Object.keys(PERMISSIONS).length);
  });
  it('IAM-004 rejects cross-organization assignments and referenced deletes', async () => {
    const branch = await prisma.branch.create({
      data: { organizationId: orgs[1]!, code: 'OTHER', name: 'Other' },
    });
    await expect(
      prisma.userBranchAccess.create({
        data: { organizationId: orgs[0]!, userId, branchId: branch.id },
      }),
    ).rejects.toThrow();
    await prisma.$transaction((tx) => seedIam(tx, orgs[1]!));
    const role = await prisma.role.findFirstOrThrow({ where: { organizationId: orgs[1] } });
    await expect(
      prisma.userRole.create({ data: { organizationId: orgs[0]!, userId, roleId: role.id } }),
    ).rejects.toThrow();
    await expect(prisma.organization.delete({ where: { id: orgs[0] } })).rejects.toThrow();
  });
  it('IAM-007 enforces hash uniqueness, family-bound successor and rotation state', async () => {
    const expiresAt = new Date(Date.now() + 86400000);
    const family = await prisma.refreshFamily.create({
      data: { organizationId: orgs[0]!, userId, expiresAt },
    });
    const other = await prisma.refreshFamily.create({
      data: { organizationId: orgs[0]!, userId, expiresAt },
    });
    familyIds.push(family.id, other.id);
    const tokenHash = randomBytes(32).toString('hex');
    const session = await prisma.refreshSession.create({
      data: { familyId: family.id, tokenHash, expiresAt },
    });
    await expect(
      prisma.refreshSession.create({ data: { familyId: other.id, tokenHash, expiresAt } }),
    ).rejects.toThrow();
    const wrong = await prisma.refreshSession.create({
      data: { familyId: other.id, tokenHash: randomBytes(32).toString('hex'), expiresAt },
    });
    await expect(
      prisma.refreshSession.update({
        where: { id: session.id },
        data: { replacedBy: wrong.id, rotatedAt: new Date() },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.refreshSession.update({ where: { id: session.id }, data: { rotatedAt: new Date() } }),
    ).rejects.toThrow();
    const successor = await prisma.refreshSession.create({
      data: { familyId: family.id, tokenHash: randomBytes(32).toString('hex'), expiresAt },
    });
    await prisma.refreshSession.update({
      where: { id: session.id },
      data: { replacedBy: successor.id, rotatedAt: new Date() },
    });
    await expect(prisma.refreshFamily.delete({ where: { id: family.id } })).rejects.toThrow();
  });
});
