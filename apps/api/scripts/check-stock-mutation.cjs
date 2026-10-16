const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
require('dotenv').config({ quiet: true });
assert(
  process.env.TEST_DATABASE_URL &&
    new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test'),
  'Explicit test database required',
);
const target = path.resolve(
  __dirname,
  '../src/modules/inventory/application/reservations.service.ts',
);
const original = fs.readFileSync(target, 'utf8');
const guard = ' AND on_hand - reserved >= ${quantity}::numeric';
assert.equal(original.split(guard).length, 2, 'Exactly one availability guard must be mutated');
try {
  fs.writeFileSync(target, original.replace(guard, ''));
  const result = spawnSync(
    process.execPath,
    [
      require.resolve('jest/bin/jest'),
      '--runInBand',
      '--testMatch=**/stock-concurrency.integration-spec.ts',
      '--testNamePattern=round 1: 100 contenders$',
      '--coverage=false',
    ],
    {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL, NODE_ENV: 'test' },
      encoding: 'utf8',
      timeout: 60000,
    },
  );
  if (result.error) throw result.error;
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  fs.mkdirSync(path.resolve(__dirname, '../coverage'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, '../coverage/stock-mutation.log'), output);
  assert.notEqual(result.status, 0, 'Removing the availability guard must fail the stock test');
  assert(
    output.includes('round 1: 100 contenders') &&
      output.includes('INSUFFICIENT_STOCK') &&
      output.includes('P2010'),
    'Failure must be the expected stock-error assertion, not setup or database availability',
  );
} finally {
  fs.writeFileSync(target, original);
  assert.equal(fs.readFileSync(target, 'utf8'), original, 'Restore original source after mutation');
}
console.log('Stock availability mutation detected; source restored');
