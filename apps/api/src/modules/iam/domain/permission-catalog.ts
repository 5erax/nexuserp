export type Scope = 'ORG' | 'BRANCH' | 'OWN';
export const PERMISSIONS = {
  'iam.users.read': ['ORG', 'BRANCH'],
  'iam.users.manage': ['ORG'],
  'iam.roles.read': ['ORG'],
  'iam.roles.manage': ['ORG'],
  'iam.branches.read': ['ORG', 'BRANCH'],
  'iam.branches.manage': ['ORG'],
  'iam.organization.read': ['ORG'],
  'iam.organization.update': ['ORG'],
  'catalog.products.read': ['ORG'],
  'catalog.products.manage': ['ORG'],
  'inventory.warehouses.read': ['ORG', 'BRANCH'],
  'inventory.warehouses.manage': ['ORG'],
  'inventory.balances.read': ['ORG', 'BRANCH'],
  'inventory.movements.read': ['ORG', 'BRANCH'],
  'inventory.adjustments.create': ['ORG', 'BRANCH'],
  'inventory.adjustments.approve': ['ORG', 'BRANCH'],
  'inventory.adjustments.post': ['ORG', 'BRANCH'],
  'crm.customers.read': ['ORG', 'BRANCH'],
  'crm.customers.create': ['ORG', 'BRANCH'],
  'crm.customers.update': ['ORG', 'BRANCH'],
  'sales.orders.read': ['ORG', 'BRANCH', 'OWN'],
  'sales.orders.create': ['ORG', 'BRANCH'],
  'sales.orders.update': ['ORG', 'BRANCH', 'OWN'],
  'sales.orders.confirm': ['ORG', 'BRANCH', 'OWN'],
  'sales.orders.cancel': ['ORG', 'BRANCH', 'OWN'],
  'sales.orders.history': ['ORG', 'BRANCH', 'OWN'],
  'sales.shipments.create': ['ORG', 'BRANCH'],
  'sales.shipments.post': ['ORG', 'BRANCH'],
  'finance.payments.read': ['ORG', 'BRANCH', 'OWN'],
  'finance.payments.create': ['ORG', 'BRANCH'],
  'reporting.dashboard.read': ['ORG', 'BRANCH'],
  'reporting.sales.read': ['ORG', 'BRANCH'],
  'reporting.inventory.read': ['ORG', 'BRANCH'],
  'reporting.exports.create': ['ORG', 'BRANCH'],
  'audit.logs.read': ['ORG', 'BRANCH'],
} as const;
export type PermissionCode = keyof typeof PERMISSIONS;
export const SYSTEM_ROLES = {
  BUSINESS_OWNER: 'Chủ doanh nghiệp',
  SYSTEM_ADMINISTRATOR: 'Quản trị hệ thống',
  BRANCH_MANAGER: 'Quản lý chi nhánh',
  SALES_STAFF: 'Nhân viên bán hàng',
  WAREHOUSE_STAFF: 'Nhân viên kho',
} as const;
export type SystemRole = keyof typeof SYSTEM_ROLES;
export function defaultGrants(role: SystemRole): { code: PermissionCode; scope: Scope }[] {
  const codes = Object.keys(PERMISSIONS) as PermissionCode[];
  if (role === 'BUSINESS_OWNER') return codes.map((code) => ({ code, scope: 'ORG' }));
  if (role === 'SYSTEM_ADMINISTRATOR')
    return codes
      .filter((code) => code.startsWith('iam.') || code === 'audit.logs.read')
      .map((code) => ({ code, scope: 'ORG' }));
  const branchManager: PermissionCode[] = [
    'iam.users.read',
    'iam.branches.read',
    'catalog.products.read',
    'inventory.warehouses.read',
    'inventory.balances.read',
    'inventory.movements.read',
    'inventory.adjustments.create',
    'inventory.adjustments.approve',
    'inventory.adjustments.post',
    'crm.customers.read',
    'crm.customers.create',
    'crm.customers.update',
    'sales.orders.read',
    'sales.orders.create',
    'sales.orders.update',
    'sales.orders.confirm',
    'sales.orders.cancel',
    'sales.orders.history',
    'sales.shipments.create',
    'sales.shipments.post',
    'finance.payments.read',
    'finance.payments.create',
    'reporting.dashboard.read',
    'reporting.sales.read',
    'reporting.inventory.read',
    'reporting.exports.create',
    'audit.logs.read',
  ];
  const sales: PermissionCode[] = [
    'iam.branches.read',
    'catalog.products.read',
    'inventory.warehouses.read',
    'inventory.balances.read',
    'crm.customers.read',
    'crm.customers.create',
    'crm.customers.update',
    'sales.orders.read',
    'sales.orders.create',
    'sales.orders.update',
    'sales.orders.confirm',
    'sales.orders.cancel',
    'sales.orders.history',
    'finance.payments.read',
  ];
  const warehouse: PermissionCode[] = [
    'iam.branches.read',
    'catalog.products.read',
    'inventory.warehouses.read',
    'inventory.balances.read',
    'inventory.movements.read',
    'inventory.adjustments.create',
    'inventory.adjustments.post',
    'sales.orders.read',
    'sales.orders.history',
    'sales.shipments.create',
    'sales.shipments.post',
    'reporting.inventory.read',
  ];
  return (
    role === 'BRANCH_MANAGER' ? branchManager : role === 'SALES_STAFF' ? sales : warehouse
  ).map((code) => ({
    code,
    scope:
      code === 'catalog.products.read'
        ? 'ORG'
        : role === 'SALES_STAFF' &&
            ((code.startsWith('sales.orders.') && code !== 'sales.orders.create') ||
              code === 'finance.payments.read')
          ? 'OWN'
          : 'BRANCH',
  }));
}
