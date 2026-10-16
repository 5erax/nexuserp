import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const foreignModels = new Set([
  'organization',
  'branch',
  'customer',
  'product',
  'productVariant',
  'warehouse',
  'stockReservation',
  'stockBalance',
  'stockMovement',
  'payment',
  'documentSequence',
]);
const foreignTables = [
  'organizations',
  'branches',
  'customers',
  'products',
  'product_variants',
  'warehouses',
  'stock_reservations',
  'stock_balances',
  'stock_movements',
  'payments',
  'document_sequences',
];
const databaseMethods = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);
function bypasses(text: string) {
  const source = ts.createSourceFile('sales.ts', text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      databaseMethods.has(node.expression.name.text) &&
      foreignModels.has(node.expression.expression.name.text)
    )
      found.push(node.expression.expression.name.text);
    if (ts.isTaggedTemplateExpression(node)) {
      const sql = node.template.getText(source).replaceAll('"', '');
      for (const table of foreignTables)
        if (new RegExp(`\\b(?:FROM|JOIN|INTO|UPDATE)\\s+${table}\\b`, 'i').test(sql))
          found.push(table);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
describe('Sales module read ownership', () => {
  it('routes foreign persistence reads through public application interfaces', () => {
    const root = join(__dirname, '../src/modules/sales');
    const files = ts.sys.readDirectory(root, ['.ts'], ['**/*.spec.ts']);
    expect(
      files.flatMap((file) =>
        bypasses(readFileSync(file, 'utf8')).map((model) => `${file}: ${model}`),
      ),
    ).toEqual([]);
  });
  it('detects ORM/raw SQL bypasses and permits public interface calls', () => {
    for (const text of [
      'tx.customer.findFirst({where})',
      'this.prisma.productVariant.findMany({where})',
      'tx.$queryRaw`SELECT * FROM warehouses`',
      'Prisma.sql`SELECT * FROM products p JOIN product_variants v ON true`',
    ])
      expect(bypasses(text).length).toBeGreaterThan(0);
    expect(bypasses('catalog.lockActiveVariants(tx, organizationId, ids)')).toEqual([]);
    expect(bypasses('this.organization.lockBranch(tx, organizationId, branchId)')).toEqual([]);
  });
});
