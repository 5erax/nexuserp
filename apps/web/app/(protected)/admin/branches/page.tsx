'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@nexus/contracts';
import { Button } from '@nexus/ui/button';
import { Input } from '@nexus/ui/components/input';
import { DataTable } from '@nexus/ui/data-table';
import { Dialog } from '@nexus/ui/dialog';
import { api, csrfParams, ApiFailure, unwrap } from '../../../../lib/auth/api';
import { useSession } from '../../../../lib/auth/session';
import { SessionGate } from '../../../../components/session-gate';
import { FormError } from '../../../../components/form-error';
import { ListTools } from '../../../../components/list-tools';
type Branch = components['schemas']['BranchData'];
export default function BranchesPage() {
  return (
    <SessionGate permission="iam.branches.read">
      <Branches />
    </SessionGate>
  );
}
function Branches() {
  const client = useQueryClient(),
    { data: actor } = useSession();
  const [page, setPage] = useState(1),
    [q, setQ] = useState(''),
    [sortOrder, setSort] = useState<'asc' | 'desc'>('desc');
  const [edit, setEdit] = useState<Branch | null | undefined>(),
    [toggle, setToggle] = useState<Branch>(),
    [pending, setPending] = useState(false),
    [error, setError] = useState<unknown>();
  const query = useQuery({
    queryKey: ['branches', page, q, sortOrder],
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/branches', {
          params: { query: { page, pageSize: 20, q, sortOrder } },
        }),
      ),
    retry: false,
  });
  const canManage = actor?.grants['iam.branches.manage']?.includes('ORG');
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const form = new FormData(event.currentTarget),
      body = { code: String(form.get('code')).trim(), name: String(form.get('name')).trim() };
    try {
      if (edit)
        unwrap(
          await api.PATCH('/api/v1/branches/{id}', {
            params: { ...(await csrfParams()), path: { id: edit.id } },
            body,
          }),
        );
      else unwrap(await api.POST('/api/v1/branches', { params: await csrfParams(), body }));
      setEdit(undefined);
      await client.invalidateQueries({ queryKey: ['branches'] });
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }
  async function changeStatus() {
    if (!toggle) return;
    setPending(true);
    setError(undefined);
    try {
      unwrap(
        await api.PATCH('/api/v1/branches/{id}', {
          params: { ...(await csrfParams()), path: { id: toggle.id } },
          body: { status: toggle.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' },
        }),
      );
      setToggle(undefined);
      await client.invalidateQueries({ queryKey: ['branches'] });
      await client.invalidateQueries({ queryKey: ['session'] });
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <h1>Chi nhánh</h1>
        <p>Quản lý địa điểm hoạt động và phạm vi cấp cho nhân viên.</p>
      </div>
      {canManage ? (
        <Button
          onClick={() => {
            setError(undefined);
            setEdit(null);
          }}
        >
          Tạo chi nhánh
        </Button>
      ) : null}
      {edit !== undefined ? (
        <section className="edit-panel">
          <h2>{edit ? 'Sửa chi nhánh' : 'Tạo chi nhánh'}</h2>
          <form key={edit?.id ?? 'new'} className="form-stack" onSubmit={save} aria-busy={pending}>
            <FormError error={error} />
            <label>
              Mã chi nhánh
              <Input
                name="code"
                defaultValue={edit?.code}
                pattern="[A-Za-z][A-Za-z0-9_-]*"
                maxLength={32}
                required
              />
            </label>
            <label>
              Tên chi nhánh
              <Input name="name" defaultValue={edit?.name} maxLength={200} required />
            </label>
            <div className="actions">
              <Button type="submit" disabled={pending}>
                Lưu chi nhánh
              </Button>
              <button type="button" disabled={pending} onClick={() => setEdit(undefined)}>
                Hủy
              </button>
            </div>
          </form>
        </section>
      ) : null}
      <ListTools
        onSearch={(value) => {
          setQ(value);
          setPage(1);
        }}
        sortOrder={sortOrder}
        onSort={(value) => {
          setSort(value);
          setPage(1);
        }}
      />
      <DataTable
        label="Danh sách chi nhánh"
        rows={query.data?.data ?? []}
        columns={[
          { id: 'code', title: 'Mã', cell: (b) => b.code },
          { id: 'name', title: 'Chi nhánh', cell: (b) => b.name },
          {
            id: 'status',
            title: 'Trạng thái',
            cell: (b) => (b.status === 'ACTIVE' ? 'Hoạt động' : 'Ngừng hoạt động'),
          },
          {
            id: 'actions',
            title: 'Thao tác',
            cell: (b) =>
              canManage ? (
                <div className="actions">
                  <button
                    onClick={() => {
                      setError(undefined);
                      setEdit(b);
                    }}
                  >
                    Sửa
                  </button>
                  <button
                    onClick={() => {
                      setError(undefined);
                      setToggle(b);
                    }}
                  >
                    {b.status === 'ACTIVE' ? 'Ngừng hoạt động' : 'Kích hoạt'}
                  </button>
                </div>
              ) : null,
          },
        ]}
        page={page}
        pageSize={20}
        total={query.data?.meta.total ?? 0}
        onPageChange={setPage}
        pending={query.isPending}
        error={query.error instanceof ApiFailure ? query.error : query.error ? {} : null}
        onRetry={() => void query.refetch()}
      />
      {toggle ? (
        <Dialog
          title={toggle.status === 'ACTIVE' ? 'Ngừng hoạt động chi nhánh?' : 'Kích hoạt chi nhánh?'}
          busy={pending}
          onClose={() => setToggle(undefined)}
        >
          <p>
            {toggle.name}. Các nhân viên cần được cấp chi nhánh hoạt động khác trước khi ngừng chi
            nhánh.
          </p>
          <FormError error={error} />
          <Button disabled={pending} onClick={() => void changeStatus()}>
            {pending ? 'Đang lưu…' : 'Xác nhận'}
          </Button>
        </Dialog>
      ) : null}
    </>
  );
}
