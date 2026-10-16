import 'dotenv/config';
import { isUUID } from 'class-validator';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { parseEnvironment } from '../src/config/environment';
import { ReconciliationService } from '../src/modules/inventory/application/reconciliation.service';

async function main() {
  const [organizationId, pageText = '1', extra] = process.argv.slice(2);
  const page = Number(pageText);
  if (
    !organizationId ||
    !isUUID(organizationId, '4') ||
    !/^\d+$/.test(pageText) ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 1000000 ||
    extra !== undefined
  ) {
    console.error(
      'Cách dùng: pnpm --filter @nexus/api inventory:reconcile <organization-uuid> [page]; mỗi trang tối đa 100 sai lệch.',
    );
    process.exitCode = 1;
    return;
  }
  const prisma = new PrismaService(parseEnvironment(process.env));
  try {
    const report = await new ReconciliationService(prisma).check(organizationId, {
      page,
      pageSize: 100,
    });
    console.log(JSON.stringify({ data: report.items, meta: report.meta }));
    if ('total' in report.meta && report.meta.total > 0) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}
void main().catch(() => {
  console.error('Không thể đối soát tồn kho. Kiểm tra cấu hình, kết nối và quyền database.');
  process.exitCode = 1;
});
