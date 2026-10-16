'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '../lib/auth/session';
import messages from '../messages/vi.json';
function SessionLinks() {
  const { data } = useSession();
  const routes = [
    ['iam.users.read', 'users'],
    ['iam.roles.read', 'roles'],
    ['iam.branches.read', 'branches'],
    ['iam.organization.read', 'organization'],
  ];
  const admin = routes.find(([permission]) => data?.grants[permission!]?.length)?.[1];
  return (
    <>
      <Link href="/workspace">{messages.auth.workspaceTitle}</Link>
      {data?.grants['catalog.products.read']?.includes('ORG') ? (
        <Link href="/catalog/products">Sản phẩm</Link>
      ) : null}
      {['inventory.balances.read', 'inventory.movements.read'].some(
        (permission) => data?.grants[permission]?.length,
      ) ? (
        <Link href="/inventory">Tồn kho</Link>
      ) : null}
      {admin ? <Link href={'/admin/' + admin}>Quản trị</Link> : null}
    </>
  );
}
export function WorkspaceNavigation() {
  const path = usePathname();
  return path.startsWith('/admin') ||
    path.startsWith('/catalog') ||
    path.startsWith('/inventory') ||
    path === '/workspace' ||
    path === '/change-password' ? (
    <SessionLinks />
  ) : (
    <Link href="/login">{messages.auth.login}</Link>
  );
}
