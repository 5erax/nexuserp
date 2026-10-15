import type { PermissionCode, Scope } from './permission-catalog';
export type Actor = {
  id: string;
  organizationId: string;
  familyId: string;
  email: string;
  displayName: string;
  mustChangePassword: boolean;
  roles: { id: string; code: string; name: string }[];
  grants: Record<string, Scope[]>;
  branchIds: string[];
};
export function scopeFilter(actor: Actor, permission: PermissionCode) {
  const scopes = actor.grants[permission] ?? [];
  const common = { organizationId: actor.organizationId };
  if (scopes.includes('ORG')) return common;
  const branches = { branchId: { in: actor.branchIds } };
  if (scopes.includes('BRANCH')) return { ...common, ...branches };
  if (scopes.includes('OWN')) return { ...common, ...branches, createdBy: actor.id };
  return { ...common, branchId: { in: [] as string[] } };
}
export function canGrant(actor: Actor, code: string, scope: Scope) {
  const scopes = actor.grants[code] ?? [];
  return (
    scopes.includes('ORG') ||
    scopes.includes(scope) ||
    (scope === 'OWN' && scopes.includes('BRANCH'))
  );
}
