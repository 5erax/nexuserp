'use client';
import Link from 'next/link';
import { useSession } from '../../../lib/auth/session';
import { SignOutButton } from '../../../components/sign-out-button';
import messages from '../../../messages/vi.json';
export default function WorkspacePage() {
  const { data } = useSession();
  if (!data) return null;
  return (
    <>
      <div className="page-heading">
        <span className="small-label">{messages.auth.signedIn}</span>
        <h1>{data.displayName}</h1>
        <p>{data.email}</p>
      </div>
      <section className="status-card">
        <h2>{messages.auth.workspaceTitle}</h2>
        <p>{messages.auth.workspaceIntro}</p>
        <dl className="profile-details">
          <dt>{messages.auth.roles}</dt>
          <dd>{data.roles.map((r) => r.name).join(', ') || messages.auth.none}</dd>
          <dt>{messages.auth.branches}</dt>
          <dd>{data.branchIds.length || messages.auth.none}</dd>
        </dl>
        <Link href="/change-password">{messages.auth.changePassword}</Link>
      </section>
      <SignOutButton />
    </>
  );
}
