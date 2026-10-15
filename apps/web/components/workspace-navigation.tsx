'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import messages from '../messages/vi.json';
function SessionLinks() {
  return (
    <>
      <Link href="/workspace">{messages.auth.workspaceTitle}</Link>
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
