'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@nexus/ui/components/input';
import { Button } from '@nexus/ui/button';
import { api, csrfParams, ApiFailure, unwrap } from '../../../lib/auth/api';
import { FormError } from '../../../components/form-error';
import messages from '../../../messages/vi.json';
export default function ChangePasswordPage() {
  const [error, setError] = useState<unknown>(),
    [pending, setPending] = useState(false);
  const router = useRouter(),
    client = useQueryClient();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const form = new FormData(event.currentTarget);
    if (form.get('newPassword') !== form.get('confirmPassword')) {
      setError(new ApiFailure(400, 'MISMATCH', messages.auth.mismatch));
      return;
    }
    setPending(true);
    try {
      unwrap(
        await api.POST('/api/v1/auth/password', {
          params: await csrfParams(),
          body: {
            currentPassword: String(form.get('currentPassword')),
            newPassword: String(form.get('newPassword')),
          },
        }),
      );
      client.clear();
      router.replace('/login?changed=1');
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="auth-panel">
      <h1>{messages.auth.changePassword}</h1>
      <p>{messages.auth.changeIntro}</p>
      <form className="form-stack" onSubmit={submit} aria-busy={pending}>
        <FormError error={error} />
        <label htmlFor="currentPassword">
          {messages.auth.currentPassword}
          <Input
            id="currentPassword"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            maxLength={128}
            required
          />
        </label>
        <label htmlFor="newPassword">
          {messages.auth.newPassword}
          <Input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
          />
        </label>
        <label htmlFor="confirmPassword">
          {messages.auth.confirmPassword}
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
          />
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? messages.auth.pending : messages.auth.changePassword}
        </Button>
      </form>
    </div>
  );
}
