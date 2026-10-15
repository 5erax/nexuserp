const { spawnSync } = require('node:child_process');
const path = require('node:path');
require('dotenv').config({ quiet: true });
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test')) {
  throw new Error('TEST_DATABASE_URL must point to an explicit database ending in _test');
}
const env = { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test' };
const prisma = path.join(path.dirname(require.resolve('prisma/package.json')), 'build/index.js');
const jest = require.resolve('jest/bin/jest');
const suite = process.argv[2] ?? 'all';
if (!['all', 'foundation', 'security'].includes(suite))
  throw new Error('Unknown integration suite');
const tests =
  suite === 'security'
    ? ['--testMatch=**/auth.integration-spec.ts', '--testMatch=**/users.integration-spec.ts']
    : [
        '--testMatch=**/*.integration-spec.ts',
        ...(suite === 'foundation'
          ? ['--testPathIgnorePatterns=auth.integration-spec|users.integration-spec']
          : []),
      ];
for (const [file, args] of [
  [prisma, ['migrate', 'deploy']],
  [jest, ['--runInBand', ...tests, '--coverage', '--coverageDirectory=coverage/integration']],
]) {
  const result = spawnSync(process.execPath, [file, ...args], { env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
