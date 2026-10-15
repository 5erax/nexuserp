'use client';
import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@nexus/ui/button';
import { LoadingState } from '@nexus/ui/states';
import { useSession } from '../lib/auth/session';
import { ApiFailure } from '../lib/auth/api';
import { FormError } from './form-error';
import messages from '../messages/vi.json';
export function SessionGate({
  children,
  permission,
}: {
  children: React.ReactNode;
  permission?: string;
}) {
  const session = useSession();
  const router = useRouter(),
    pathname = usePathname(),
    search = useSearchParams();
  const unauthorized = session.error instanceof ApiFailure && session.error.status === 401;
  const mustChange = session.data?.mustChangePassword && pathname !== '/change-password';
  const forbidden = !!(session.data && permission && !session.data.grants[permission]?.length);
  useEffect(() => {
    if (unauthorized)
      router.replace(
        '/login?returnTo=' +
          encodeURIComponent(pathname + (search.size ? '?' + search.toString() : '')),
      );
    else if (mustChange) router.replace('/change-password');
    else if (forbidden) router.replace('/forbidden');
  }, [unauthorized, mustChange, forbidden, router, pathname, search]);
  if (session.isPending || unauthorized || mustChange || forbidden)
    return <LoadingState label={messages.auth.loading} />;
  if (session.error)
    return (
      <>
        <FormError error={session.error} />
        <Button onClick={() => void session.refetch()}>{messages.auth.retry}</Button>
      </>
    );
  return children;
}
