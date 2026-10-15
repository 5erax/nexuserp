'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Button } from '@nexus/ui/button';
import { useSession } from '../../../lib/auth/session';
import { api, csrfParams, unwrap } from '../../../lib/auth/api';
import { FormError } from '../../../components/form-error';
import messages from '../../../messages/vi.json';
export default function WorkspacePage() {
  const { data } = useSession();
  const client = useQueryClient(),
    router = useRouter();
  const [error, setError] = useState<unknown>(),
    [pending, setPending] = useState(false);
  async function logout() {
    setPending(true);
    setError(undefined);
    try {
      unwrap(await api.POST('/api/v1/auth/logout', { params: await csrfParams() }));
      client.clear();
      router.replace('/login');
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }
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
      <FormError error={error} />
      <Button onClick={() => void logout()} disabled={pending}>
        {pending ? messages.auth.pending : messages.auth.logout}
      </Button>
    </>
  );
}
