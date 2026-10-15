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
import { UserForm } from '../../../../components/user-form';
type User = components['schemas']['UserData'];
export default function UsersPage() {
  return (
    <SessionGate permission="iam.users.read">
      <Users />
    </SessionGate>
  );
}
function Users() {
  const client = useQueryClient(),
    { data: actor } = useSession();
  const [page, setPage] = useState(1),
    [q, setQ] = useState(''),
    [status, setStatus] = useState<'ACTIVE' | 'INACTIVE' | 'LOCKED' | undefined>(),
    [sortOrder, setSort] = useState<'asc' | 'desc'>('desc');
  const [edit, setEdit] = useState<User | null | undefined>(),
    [action, setAction] = useState<{ user: User; kind: 'status' | 'reset' }>(),
    [pending, setPending] = useState(false),
    [error, setError] = useState<unknown>();
  const query = useQuery({
    queryKey: ['users', page, q, status, sortOrder],
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/users', {
          params: { query: { page, pageSize: 20, q, status, sortOrder } },
        }),
      ),
    retry: false,
  });
  const canManage = actor?.grants['iam.users.manage']?.includes('ORG');
  async function saved() {
    await client.invalidateQueries({ queryKey: ['users'] });
    await client.invalidateQueries({ queryKey: ['session'] });
    setEdit(undefined);
  }
  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action) return;
    setPending(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      unwrap(
        await api.PATCH('/api/v1/users/{id}', {
          params: { ...(await csrfParams()), path: { id: action.user.id } },
          body:
            action.kind === 'reset'
              ? { temporaryPassword: String(form.get('temporaryPassword')) }
              : { status: action.user.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' },
        }),
      );
      setAction(undefined);
      await saved();
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <h1>Người dùng</h1>
        <p>
          Cấp tài khoản, vai trò và chi nhánh; thay đổi nhạy cảm sẽ thu hồi phiên hiện tại của nhân
          viên.
        </p>
      </div>
      {canManage ? <Button onClick={() => setEdit(null)}>Tạo người dùng</Button> : null}
      {edit !== undefined ? (
        <UserForm
          key={edit?.id ?? 'new'}
          user={edit}
          onSave={saved}
          onCancel={() => setEdit(undefined)}
        />
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
      >
        <label>
          Trạng thái
          <select
            value={status ?? ''}
            onChange={(e) => {
              const value = e.target.value;
              setStatus(
                value === 'ACTIVE' || value === 'INACTIVE' || value === 'LOCKED'
                  ? value
                  : undefined,
              );
              setPage(1);
            }}
          >
            <option value="">Tất cả</option>
            <option value="ACTIVE">Hoạt động</option>
            <option value="INACTIVE">Ngừng hoạt động</option>
            <option value="LOCKED">Đã khóa</option>
          </select>
        </label>
      </ListTools>
      <DataTable
        label="Danh sách người dùng"
        rows={query.data?.data ?? []}
        columns={[
          {
            id: 'name',
            title: 'Người dùng',
            cell: (u) => (
              <>
                <strong>{u.displayName}</strong>
                <br />
                {u.email}
              </>
            ),
          },
          {
            id: 'roles',
            title: 'Vai trò',
            cell: (u) => u.roles.map((r) => r.name).join(', ') || 'Chưa cấp',
          },
          { id: 'branches', title: 'Chi nhánh', cell: (u) => u.branchIds.length },
          {
            id: 'status',
            title: 'Trạng thái',
            cell: (u) =>
              u.status === 'ACTIVE'
                ? 'Hoạt động'
                : u.status === 'LOCKED'
                  ? 'Đã khóa'
                  : 'Ngừng hoạt động',
          },
          {
            id: 'actions',
            title: 'Thao tác',
            cell: (u) =>
              canManage ? (
                <div className="actions">
                  <button onClick={() => setEdit(u)}>Sửa</button>
                  <button
                    onClick={() => {
                      setError(undefined);
                      setAction({ user: u, kind: 'status' });
                    }}
                  >
                    {u.status === 'ACTIVE' ? 'Vô hiệu hóa' : 'Kích hoạt'}
                  </button>
                  <button
                    onClick={() => {
                      setError(undefined);
                      setAction({ user: u, kind: 'reset' });
                    }}
                  >
                    Đặt lại mật khẩu
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
      {action ? (
        <Dialog
          title={
            action.kind === 'reset'
              ? 'Đặt lại mật khẩu?'
              : action.user.status === 'ACTIVE'
                ? 'Vô hiệu hóa tài khoản?'
                : 'Kích hoạt tài khoản?'
          }
          busy={pending}
          onClose={() => setAction(undefined)}
        >
          <p>
            {action.user.displayName} · {action.user.email}. Các phiên liên quan sẽ bị thu hồi.
          </p>
          <form className="form-stack" onSubmit={confirm}>
            <FormError error={error} />
            {action.kind === 'reset' ? (
              <label>
                Mật khẩu tạm mới
                <Input
                  name="temporaryPassword"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                />
                <span className="field-hint">
                  Nhân viên phải đổi mật khẩu ở lần đăng nhập tiếp theo.
                </span>
              </label>
            ) : null}
            <Button type="submit" disabled={pending}>
              {pending ? 'Đang lưu…' : 'Xác nhận'}
            </Button>
          </form>
        </Dialog>
      ) : null}
    </>
  );
}
