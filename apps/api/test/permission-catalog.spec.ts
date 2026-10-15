import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PERMISSIONS,
  SYSTEM_ROLES,
  defaultGrants,
} from '../src/modules/iam/domain/permission-catalog';
describe('IAM-003 permission catalog', () => {
  it('covers the documented catalog exactly', () => {
    const matrix = readFileSync(
      resolve(__dirname, '../../../docs/business-rules/PERMISSION_MATRIX.md'),
      'utf8',
    );
    const codes = [...matrix.matchAll(/^\| ([a-z]+\.[a-z]+\.[a-z]+) \|/gm)].map(
      (match) => match[1],
    );
    expect(Object.keys(PERMISSIONS).sort()).toEqual(codes.sort());
    for (const role of Object.keys(SYSTEM_ROLES) as (keyof typeof SYSTEM_ROLES)[])
      for (const grant of defaultGrants(role))
        expect(PERMISSIONS[grant.code] as readonly string[]).toContain(grant.scope);
  });
  it('does not give sales approval or administration and keeps own-order restrictions', () => {
    const sales = defaultGrants('SALES_STAFF');
    expect(sales).toContainEqual({ code: 'sales.orders.confirm', scope: 'OWN' });
    expect(
      sales.some(
        (grant) =>
          grant.code === 'inventory.adjustments.approve' || grant.code === 'iam.users.manage',
      ),
    ).toBe(false);
    expect(
      defaultGrants('SYSTEM_ADMINISTRATOR').every(
        (grant) => grant.code.startsWith('iam.') || grant.code === 'audit.logs.read',
      ),
    ).toBe(true);
  });
});
