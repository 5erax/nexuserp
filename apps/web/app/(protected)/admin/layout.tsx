'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '../../../lib/auth/session';
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { data } = useSession();
  const path = usePathname();
  const tabs = [
    ['users', 'Người dùng', 'iam.users.read'],
    ['roles', 'Vai trò', 'iam.roles.read'],
    ['branches', 'Chi nhánh', 'iam.branches.read'],
    ['organization', 'Tổ chức', 'iam.organization.read'],
  ];
  return (
    <>
      <nav className="admin-tabs" aria-label="Quản trị">
        {tabs
          .filter(([, , permission]) => data?.grants[permission!]?.length)
          .map(([route, label]) => (
            <Link
              key={route}
              href={'/admin/' + route}
              aria-current={path === '/admin/' + route ? 'page' : undefined}
            >
              {label}
            </Link>
          ))}
      </nav>
      {children}
    </>
  );
}
