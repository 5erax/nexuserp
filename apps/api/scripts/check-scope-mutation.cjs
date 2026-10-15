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
const target = path.resolve(__dirname, '../src/modules/iam/application/users.service.ts');
const original = fs.readFileSync(target, 'utf8');
const mutated = original.replace('this.where(actor),', '{ organizationId: actor.organizationId },');
assert.notEqual(original, mutated, 'Scope mutation must modify the intended query');
try {
  fs.writeFileSync(target, mutated);
  const result = spawnSync(
    process.execPath,
    [
      require.resolve('jest/bin/jest'),
      '--runInBand',
      '--testMatch=**/users.integration-spec.ts',
      '--testNamePattern=IAM-004',
    ],
    {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL, NODE_ENV: 'test' },
      encoding: 'utf8',
    },
  );
  if (result.error) throw result.error;
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  fs.mkdirSync(path.resolve(__dirname, '../coverage'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, '../coverage/scope-mutation.log'), output);
  assert.notEqual(result.status, 0, 'Removing branch scope must fail the original security test');
  assert(
    output.includes('IAM-004 filters users') &&
      output.includes('Expected: 3') &&
      output.includes('Received:'),
    'Failure must be the branch-isolation assertion',
  );
} finally {
  fs.writeFileSync(target, original);
  assert.equal(fs.readFileSync(target, 'utf8'), original, 'Restore original source after mutation');
}
console.log('IAM-004 mutation detected; source restored');
