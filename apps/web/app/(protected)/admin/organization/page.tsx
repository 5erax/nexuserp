'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Input } from '@nexus/ui/components/input';
import { Button } from '@nexus/ui/button';
import { LoadingState } from '@nexus/ui/states';
import { api, csrfParams, unwrap } from '../../../../lib/auth/api';
import { useSession } from '../../../../lib/auth/session';
import { SessionGate } from '../../../../components/session-gate';
import { FormError } from '../../../../components/form-error';
export default function OrganizationPage() {
  return (
    <SessionGate permission="iam.organization.read">
      <Organization />
    </SessionGate>
  );
}
function Organization() {
  const { data: actor } = useSession(),
    client = useQueryClient();
  const query = useQuery({
    queryKey: ['organization'],
    queryFn: async () => unwrap(await api.GET('/api/v1/organization')).data,
    retry: false,
  });
  const [error, setError] = useState<unknown>(),
    [pending, setPending] = useState(false),
    [saved, setSaved] = useState(false);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    setSaved(false);
    const form = new FormData(event.currentTarget);
    try {
      unwrap(
        await api.PATCH('/api/v1/organization', {
          params: await csrfParams(),
          body: {
            name: String(form.get('name')).trim(),
            currency: 'VND',
            timezone: String(form.get('timezone')).trim(),
          },
        }),
      );
      await client.invalidateQueries({ queryKey: ['organization'] });
      setSaved(true);
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }
  if (query.isPending) return <LoadingState />;
  if (query.error)
    return (
      <>
        <FormError error={query.error} />
        <Button onClick={() => void query.refetch()}>Thử lại</Button>
      </>
    );
  const org = query.data!;
  const canEdit = actor?.grants['iam.organization.update']?.includes('ORG');
  return (
    <>
      <h1>Hồ sơ tổ chức</h1>
      <p>
        Mã tổ chức: {org.code} · Tiền tệ: {org.currency}
      </p>
      <form className="form-stack edit-panel" onSubmit={save} aria-busy={pending}>
        <FormError error={error} />
        {saved ? <p role="status">Đã lưu hồ sơ tổ chức.</p> : null}
        <label>
          Tên tổ chức
          <Input name="name" defaultValue={org.name} maxLength={200} required readOnly={!canEdit} />
        </label>
        <label>
          Múi giờ
          <Input
            name="timezone"
            defaultValue={org.timezone}
            maxLength={64}
            required
            readOnly={!canEdit}
          />
        </label>
        {canEdit ? (
          <Button type="submit" disabled={pending}>
            Lưu hồ sơ
          </Button>
        ) : null}
      </form>
    </>
  );
}
