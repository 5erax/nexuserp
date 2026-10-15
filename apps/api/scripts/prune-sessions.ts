import 'dotenv/config';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { parseEnvironment } from '../src/config/environment';
import { pruneExpiredSessions } from '../src/modules/iam/infrastructure/prune-sessions';
async function main() {
  const prisma = new PrismaService(parseEnvironment(process.env));
  try {
    console.log(
      `Removed ${await pruneExpiredSessions(prisma)} expired refresh families (batch limit 100); audit retained.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}
void main();
