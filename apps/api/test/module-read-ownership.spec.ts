import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const persistence = [
  ['organization', 'organizations', 'iam'],
  ['branch', 'branches', 'iam'],
  ['customer', 'customers', 'crm'],
  ['product', 'products', 'catalog'],
  ['productVariant', 'product_variants', 'catalog'],
  ['warehouse', 'warehouses', 'inventory'],
  ['stockReservation', 'stock_reservations', 'inventory'],
  ['stockBalance', 'stock_balances', 'inventory'],
  ['stockMovement', 'stock_movements', 'inventory'],
  ['payment', 'payments', 'finance'],
  ['documentSequence', 'document_sequences', 'platform'],
  ['salesOrder', 'sales_orders', 'sales'],
  ['salesOrderItem', 'sales_order_items', 'sales'],
  ['shipment', 'shipments', 'sales'],
  ['shipmentItem', 'shipment_items', 'sales'],
  ['orderEvent', 'order_events', 'sales'],
] as const;
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
function bypasses(text: string, owner: 'sales' | 'crm') {
  const foreign = persistence.filter(([, , module]) => module !== owner);
  const foreignModels = new Set<string>(foreign.map(([model]) => model));
  const foreignTables = foreign.map(([, table]) => table);
  const source = ts.createSourceFile('module.ts', text, ts.ScriptTarget.Latest, true);
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
describe('Sales/CRM module read ownership', () => {
  it.each(['sales', 'crm'] as const)(
    '%s routes foreign reads through public application interfaces',
    (owner) => {
      const root = join(__dirname, '../src/modules', owner);
      const files = ts.sys.readDirectory(root, ['.ts'], ['**/*.spec.ts']);
      expect(
        files.flatMap((file) =>
          bypasses(readFileSync(file, 'utf8'), owner).map((model) => `${file}: ${model}`),
        ),
      ).toEqual([]);
    },
  );
  it('detects ORM/raw SQL bypasses and permits public interface calls', () => {
    for (const text of [
      'tx.customer.findFirst({where})',
      'this.prisma.productVariant.findMany({where})',
      'tx.$queryRaw`SELECT * FROM warehouses`',
      'Prisma.sql`SELECT * FROM products p JOIN product_variants v ON true`',
    ])
      expect(bypasses(text, 'sales').length).toBeGreaterThan(0);
    expect(bypasses('tx.salesOrder.findMany({where})', 'crm')).toEqual(['salesOrder']);
    expect(bypasses('catalog.lockActiveVariants(tx, organizationId, ids)', 'sales')).toEqual([]);
    expect(bypasses('this.organization.lockBranch(tx, organizationId, branchId)', 'crm')).toEqual(
      [],
    );
  });
});
