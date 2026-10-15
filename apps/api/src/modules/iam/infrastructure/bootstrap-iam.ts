import { z } from 'zod';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit/application/audit.service';
import { PasswordService } from '../application/password.service';
import { seedIam } from './seed-permissions';
export const bootstrapInput = z.object({
  organizationCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,32}$/),
  organizationName: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(12).max(128),
});
export async function bootstrapIam(prisma: PrismaService, input: z.input<typeof bootstrapInput>) {
  const data = bootstrapInput.parse(input);
  const passwordHash = await new PasswordService().hash(data.password);
  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: { code: data.organizationCode, name: data.organizationName },
    });
    await seedIam(tx, organization.id);
    const role = await tx.role.findUniqueOrThrow({
      where: { organizationId_code: { organizationId: organization.id, code: 'BUSINESS_OWNER' } },
    });
    const user = await tx.user.create({
      data: {
        organizationId: organization.id,
        email: data.email,
        displayName: 'Business Owner',
        passwordHash,
        mustChangePassword: true,
      },
    });
    await tx.userRole.create({
      data: { organizationId: organization.id, userId: user.id, roleId: role.id },
    });
    await new AuditService(prisma).record(tx, {
      organizationId: organization.id,
      actorId: user.id,
      action: 'iam.bootstrap',
      entityType: 'organization',
      entityId: organization.id,
      requestId: 'iam-bootstrap',
      changes: { organizationCode: organization.code, ownerId: user.id },
    });
    return { organizationId: organization.id, userId: user.id };
  });
}
