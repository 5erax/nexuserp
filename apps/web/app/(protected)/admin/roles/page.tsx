'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@nexus/contracts';
import { Button } from '@nexus/ui/button';
import { Input } from '@nexus/ui/components/input';
import { DataTable } from '@nexus/ui/data-table';
import { api, csrfParams, ApiFailure, unwrap } from '../../../../lib/auth/api';
import { useSession } from '../../../../lib/auth/session';
import { SessionGate } from '../../../../components/session-gate';
import { FormError } from '../../../../components/form-error';
import { ListTools } from '../../../../components/list-tools';
type Role = components['schemas']['RoleData'];
const modules: Record<string, string> = {
  iam: 'Tài khoản và tổ chức',
  catalog: 'Danh mục',
  inventory: 'Kho',
  crm: 'Khách hàng',
  sales: 'Bán hàng',
  finance: 'Thu tiền',
  reporting: 'Báo cáo',
  audit: 'Nhật ký',
};
const resources: Record<string, string> = {
  users: 'người dùng',
  roles: 'vai trò',
  branches: 'chi nhánh',
  organization: 'tổ chức',
  products: 'sản phẩm',
  warehouses: 'kho',
  balances: 'tồn kho',
  movements: 'biến động kho',
  adjustments: 'điều chỉnh kho',
  customers: 'khách hàng',
  orders: 'đơn hàng',
  shipments: 'giao hàng',
  payments: 'thanh toán',
  dashboard: 'tổng quan',
  sales: 'doanh thu',
  inventory: 'tồn kho',
  exports: 'xuất báo cáo',
  logs: 'nhật ký',
};
const actions: Record<string, string> = {
  read: 'Xem',
  manage: 'Quản lý',
  create: 'Tạo',
  update: 'Sửa',
  approve: 'Duyệt',
  post: 'Ghi sổ',
  confirm: 'Xác nhận',
  cancel: 'Hủy',
  history: 'Xem lịch sử',
};
function label(code: string) {
  const [, resource, action] = code.split('.');
  return `${actions[action!] ?? action} ${resources[resource!] ?? resource}`;
}
export default function RolesPage() {
  return (
    <SessionGate permission="iam.roles.read">
      <Roles />
    </SessionGate>
  );
}
function Roles() {
  const client = useQueryClient(),
    { data: actor } = useSession();
  const [page, setPage] = useState(1),
    [q, setQ] = useState(''),
    [sortOrder, setSort] = useState<'asc' | 'desc'>('desc');
  const [edit, setEdit] = useState<Role | null | undefined>(),
    [error, setError] = useState<unknown>(),
    [pending, setPending] = useState(false);
  const query = useQuery({
    queryKey: ['roles', page, q, sortOrder],
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/roles', { params: { query: { page, pageSize: 20, q, sortOrder } } }),
      ),
    retry: false,
  });
  const catalog = useQuery({
    queryKey: ['permissions'],
    queryFn: async () => unwrap(await api.GET('/api/v1/permissions')).data,
    retry: false,
  });
  const canManage = actor?.grants['iam.roles.manage']?.includes('ORG');
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    const permissions = (catalog.data ?? []).flatMap<components['schemas']['GrantInput']>((p) => {
      const scope = form.get('scope:' + p.code);
      return scope === 'ORG' || scope === 'BRANCH' || scope === 'OWN'
        ? [{ code: p.code, scope }]
        : [];
    });
    try {
      if (edit)
        unwrap(
          await api.PUT('/api/v1/roles/{id}/permissions', {
            params: { ...(await csrfParams()), path: { id: edit.id } },
            body: { permissions },
          }),
        );
      else
        unwrap(
          await api.POST('/api/v1/roles', {
            params: await csrfParams(),
            body: {
              code: String(form.get('code')).trim().toUpperCase(),
              name: String(form.get('name')).trim(),
              permissions,
            },
          }),
        );
      setEdit(undefined);
      await client.invalidateQueries({ queryKey: ['roles'] });
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
        <h1>Vai trò và quyền</h1>
        <p>
          Vai trò hệ thống có quyền cố định. Vai trò tùy chỉnh chỉ được cấp trong quyền của bạn.
        </p>
      </div>
      {canManage ? (
        <Button
          onClick={() => {
            setError(undefined);
            setEdit(null);
          }}
        >
          Tạo vai trò
        </Button>
      ) : null}
      {edit !== undefined ? (
        <section className="edit-panel">
          <h2>{edit ? edit.name : 'Vai trò mới'}</h2>
          <form key={edit?.id ?? 'new'} className="form-stack" onSubmit={save} aria-busy={pending}>
            <FormError error={error} />
            <label>
              Mã vai trò
              <Input
                name="code"
                defaultValue={edit?.code}
                pattern="[A-Za-z][A-Za-z0-9_]*"
                maxLength={64}
                required
                readOnly={!!edit}
              />
            </label>
            <label>
              Tên vai trò
              <Input
                name="name"
                defaultValue={edit?.name}
                maxLength={200}
                required
                readOnly={!!edit}
              />
            </label>
            {catalog.error ? (
              <>
                <FormError error={catalog.error} />
                <Button type="button" onClick={() => void catalog.refetch()}>
                  Tải lại danh sách quyền
                </Button>
              </>
            ) : null}
            {Object.entries(modules).map(([module, title]) => (
              <fieldset key={module} disabled={pending || edit?.isSystem || !canManage}>
                <legend>{title}</legend>
                {(catalog.data ?? [])
                  .filter((p) => p.code.startsWith(module + '.'))
                  .map((p) => (
                    <label className="permission-row" key={p.code}>
                      {label(p.code)}
                      <select
                        name={'scope:' + p.code}
                        defaultValue={edit?.permissions.find((g) => g.code === p.code)?.scope ?? ''}
                      >
                        <option value="">Không cấp</option>
                        {p.allowedScopes.map((scope) => (
                          <option key={scope} value={scope}>
                            {scope === 'ORG'
                              ? 'Toàn tổ chức'
                              : scope === 'BRANCH'
                                ? 'Chi nhánh được cấp'
                                : 'Bản ghi của mình'}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
              </fieldset>
            ))}
            {edit?.isSystem ? (
              <p>Vai trò hệ thống chỉ cho phép xem.</p>
            ) : canManage ? (
              <Button type="submit" disabled={pending || !catalog.data}>
                Lưu quyền
              </Button>
            ) : null}
            <button type="button" disabled={pending} onClick={() => setEdit(undefined)}>
              Đóng trình sửa
            </button>
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
        label="Danh sách vai trò"
        rows={query.data?.data ?? []}
        columns={[
          { id: 'name', title: 'Vai trò', cell: (r) => r.name },
          { id: 'code', title: 'Mã', cell: (r) => r.code },
          { id: 'kind', title: 'Loại', cell: (r) => (r.isSystem ? 'Hệ thống' : 'Tùy chỉnh') },
          { id: 'permissions', title: 'Số quyền', cell: (r) => r.permissions.length },
          {
            id: 'actions',
            title: 'Thao tác',
            cell: (r) => (
              <button
                onClick={() => {
                  setError(undefined);
                  setEdit(r);
                }}
              >
                {r.isSystem || !canManage ? 'Xem quyền' : 'Sửa quyền'}
              </button>
            ),
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
    </>
  );
}
