'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '../lib/auth/session';
import messages from '../messages/vi.json';
function SessionLinks() {
  const { data } = useSession();
  return (
    <>
      <Link href="/workspace">{messages.auth.workspaceTitle}</Link>
      {data && Object.keys(data.grants).some((p) => p.startsWith('iam.') && p.endsWith('.read')) ? (
        <Link href="/admin/users">Quản trị</Link>
      ) : null}
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
