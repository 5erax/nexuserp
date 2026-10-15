'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@nexus/ui/components/input';
import { Button } from '@nexus/ui/button';
import { api, csrfParams, safeReturnPath, unwrap } from '../../lib/auth/api';
import { sessionKey } from '../../lib/auth/session';
import { FormError } from '../../components/form-error';
import messages from '../../messages/vi.json';
export function LoginForm() {
  const [error, setError] = useState<unknown>(),
    [pending, setPending] = useState(false);
  const router = useRouter(),
    search = useSearchParams(),
    client = useQueryClient();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      unwrap(
        await api.POST('/api/v1/auth/login', {
          params: await csrfParams(),
          body: {
            organizationCode: String(form.get('organizationCode')).trim(),
            email: String(form.get('email')).trim(),
            password: String(form.get('password')),
          },
        }),
      );
      client.clear();
      const profile = await client.fetchQuery({
        queryKey: sessionKey,
        queryFn: async () => unwrap(await api.GET('/api/v1/auth/me')).data,
        retry: false,
      });
      router.replace(
        profile.mustChangePassword ? '/change-password' : safeReturnPath(search.get('returnTo')),
      );
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="form-stack" onSubmit={submit} aria-busy={pending}>
      {search.get('changed') === '1' ? <p role="status">{messages.auth.changed}</p> : null}
      <FormError error={error} />
      <label htmlFor="organizationCode">
        {messages.auth.organization}
        <Input
          id="organizationCode"
          name="organizationCode"
          autoComplete="organization"
          maxLength={32}
          pattern="[A-Za-z0-9_-]+"
          required
        />
      </label>
      <label htmlFor="email">
        {messages.auth.email}
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          maxLength={254}
          required
        />
      </label>
      <label htmlFor="password">
        {messages.auth.password}
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          maxLength={128}
          required
        />
      </label>
      <Button disabled={pending} type="submit">
        {pending ? messages.auth.pending : messages.auth.login}
      </Button>
    </form>
  );
}
