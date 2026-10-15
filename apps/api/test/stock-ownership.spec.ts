import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const root = join(__dirname, '../src');
const ledger = 'modules/inventory/application/stock-ledger.service.ts';
const files = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.name === 'generated'
      ? []
      : entry.isDirectory()
        ? files(join(directory, entry.name))
        : entry.name.endsWith('.ts')
          ? [join(directory, entry.name)]
          : [],
  );

function unauthorizedWriter(name: string, text: string): boolean {
  if (name === ledger) return false;
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  let invalid = false;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const call = node.expression;
      if (
        ts.isPropertyAccessExpression(call.expression) &&
        call.expression.name.text === 'stockBalance'
      ) {
        if (
          [
            'create',
            'createMany',
            'createManyAndReturn',
            'upsert',
            'delete',
            'deleteMany',
          ].includes(call.name.text)
        )
          invalid = true;
        if (['update', 'updateMany', 'updateManyAndReturn'].includes(call.name.text)) {
          const argument = node.arguments[0];
          const data =
            argument &&
            ts.isObjectLiteralExpression(argument) &&
            argument.properties.find(
              (p) => ts.isPropertyAssignment(p) && p.name.getText(source) === 'data',
            );
          if (
            !data ||
            !ts.isPropertyAssignment(data) ||
            !ts.isObjectLiteralExpression(data.initializer) ||
            data.initializer.properties.some(
              (p) =>
                !ts.isPropertyAssignment(p) ||
                !['reserved', 'version', 'updatedAt'].includes(p.name.getText(source)),
            )
          )
            invalid = true;
        }
      }
    }
    if (ts.isTaggedTemplateExpression(node)) {
      const sql = node.template.getText(source).replaceAll('"', '').replace(/\s+/g, ' ');
      if (
        /\b(?:INSERT\s+INTO|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+stock_balances\b/i.test(sql) ||
        /\bUPDATE\s+stock_balances\b[\s\S]*\bSET\b[\s\S]*\bon_hand\s*=/i.test(sql) ||
        /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+stock_movements\b/i.test(sql)
      )
        invalid = true;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      node.expression.expression.name.text === 'stockMovement' &&
      [
        'create',
        'createMany',
        'createManyAndReturn',
        'upsert',
        'update',
        'updateMany',
        'delete',
        'deleteMany',
      ].includes(node.expression.name.text)
    )
      invalid = true;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return invalid;
}

describe('INV-008 Inventory write ownership', () => {
  it('keeps all on-hand and ledger writes in StockLedgerService', () => {
    expect(
      files(root).filter((file) =>
        unauthorizedWriter(relative(root, file).replaceAll('\\', '/'), readFileSync(file, 'utf8')),
      ),
    ).toEqual([]);
  });
  it('detects ORM and SQL bypasses but allows reservation-only balance changes', () => {
    for (const text of [
      'tx.stockBalance.update({ where, data: { onHand: "9" } })',
      'tx.stockBalance.updateMany({ where, data })',
      'tx.stockBalance.upsert({ create, update })',
      'tx.stockMovement.create({ data })',
      'tx.$executeRaw`UPDATE stock_balances SET on_hand = 9`',
      'tx.$executeRaw`INSERT INTO stock_balances (id) VALUES (1)`',
      'tx.$executeRaw`DELETE FROM stock_movements`',
    ])
      expect(unauthorizedWriter('other.ts', text)).toBe(true);
    expect(
      unauthorizedWriter(
        'other.ts',
        'tx.stockBalance.update({ where, data: { reserved: "1", version: { increment: 1 } } })',
      ),
    ).toBe(false);
    expect(
      unauthorizedWriter(
        'other.ts',
        'tx.$executeRaw`UPDATE stock_balances SET reserved = reserved + 1 WHERE on_hand - reserved >= 1`',
      ),
    ).toBe(false);
  });
});
