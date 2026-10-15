'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@nexus/ui/button';
import { api, csrfParams, unwrap } from '../lib/auth/api';
import { FormError } from './form-error';
import messages from '../messages/vi.json';
export function SignOutButton({ disabled = false }: { disabled?: boolean }) {
  const [error, setError] = useState<unknown>(),
    [pending, setPending] = useState(false);
  const router = useRouter(),
    client = useQueryClient();
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
  return (
    <>
      <FormError error={error} />
      <Button type="button" onClick={() => void logout()} disabled={disabled || pending}>
        {pending ? messages.auth.pending : messages.auth.logout}
      </Button>
    </>
  );
}
