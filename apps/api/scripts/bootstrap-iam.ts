import 'dotenv/config';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { parseEnvironment } from '../src/config/environment';
import { bootstrapIam } from '../src/modules/iam/infrastructure/bootstrap-iam';
async function main() {
  const prisma = new PrismaService(parseEnvironment(process.env));
  try {
    const result = await bootstrapIam(prisma, {
      organizationCode: process.env.BOOTSTRAP_ORGANIZATION_CODE ?? '',
      organizationName: process.env.BOOTSTRAP_ORGANIZATION_NAME ?? '',
      email: process.env.BOOTSTRAP_EMAIL ?? '',
      password: process.env.BOOTSTRAP_PASSWORD ?? '',
    });
    console.log(JSON.stringify(result));
  } finally {
    await prisma.$disconnect();
  }
}
void main().catch(() => {
  console.error(
    'IAM bootstrap failed. Check required BOOTSTRAP_* fields, database access and unique organization code. Existing accounts are never overwritten.',
  );
  process.exitCode = 1;
});
