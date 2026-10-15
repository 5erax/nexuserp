import 'dotenv/config';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { parseEnvironment } from '../src/config/environment';
import { seedIam, seedPermissionCatalog } from '../src/modules/iam/infrastructure/seed-permissions';
async function main() {
  const prisma = new PrismaService(parseEnvironment(process.env));
  try {
    await prisma.$transaction(seedPermissionCatalog);
    const organizations = await prisma.organization.findMany({ select: { id: true } });
    for (const organization of organizations)
      await prisma.$transaction((tx) => seedIam(tx, organization.id));
    console.log(
      `IAM catalog seeded for ${organizations.length} organizations; no accounts created.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}
void main();
