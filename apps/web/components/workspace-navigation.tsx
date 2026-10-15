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
      {admin ? <Link href={'/admin/' + admin}>Quản trị</Link> : null}
    </>
  );
}
export function WorkspaceNavigation() {
  const path = usePathname();
  return path.startsWith('/admin') || path === '/workspace' || path === '/change-password' ? (
    <SessionLinks />
  ) : (
    <Link href="/login">{messages.auth.login}</Link>
  );
}
