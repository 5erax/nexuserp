import { randomUUID, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
export default function setup() {
  const apiDirectory = path.resolve('apps/api');
  const requireApi = createRequire(path.join(apiDirectory, 'package.json'));
  const code = 'E2E-' + randomUUID().slice(0, 8).toUpperCase();
  const email = 'owner@example.test';
  const password = randomBytes(24).toString('hex');
  execFileSync(
    process.execPath,
    [requireApi.resolve('ts-node/dist/bin.js'), 'scripts/bootstrap-iam.ts'],
    {
      cwd: apiDirectory,
      env: {
        ...process.env,
        BOOTSTRAP_ORGANIZATION_CODE: code,
        BOOTSTRAP_ORGANIZATION_NAME: 'E2E fixture',
        BOOTSTRAP_EMAIL: email,
        BOOTSTRAP_PASSWORD: password,
      },
      stdio: 'pipe',
    },
  );
  process.env.E2E_ORGANIZATION_CODE = code;
  process.env.E2E_EMAIL = email;
  process.env.E2E_PASSWORD = password;
}
