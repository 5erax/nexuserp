import 'dotenv/config';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { parseEnvironment } from '../src/config/environment';
import { pruneExpiredKeys } from '../src/common/idempotency/idempotency.service';
async function main() {
  const prisma = new PrismaService(parseEnvironment(process.env));
  try {
    console.log(
      `Removed ${await pruneExpiredKeys(prisma)} expired idempotency keys (batch limit 100).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}
void main();
