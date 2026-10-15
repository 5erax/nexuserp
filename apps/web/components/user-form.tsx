'use client';
import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { components } from '@nexus/contracts';
import { Button } from '@nexus/ui/button';
import { Input } from '@nexus/ui/components/input';
import { api, csrfParams, unwrap } from '../lib/auth/api';
import { FormError } from './form-error';
type User = components['schemas']['UserData'];
export function UserForm({
  user,
  onSave,
  onCancel,
}: {
  user: User | null;
  onSave: () => Promise<void>;
  onCancel: () => void;
}) {
  const [roleIds, setRoles] = useState(user?.roles.map((r) => r.id) ?? []),
    [branchIds, setBranches] = useState(user?.branchIds ?? []);
  const [error, setError] = useState<unknown>(),
    [pending, setPending] = useState(false);
  const roles = useInfiniteQuery({
    queryKey: ['role-options'],
    initialPageParam: 1,
    staleTime: 0,
    retry: false,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.GET('/api/v1/roles', {
          params: { query: { page: pageParam, pageSize: 100, sortOrder: 'asc' } },
        }),
      ),
    getNextPageParam: (last) =>
      last.meta.page * last.meta.pageSize < last.meta.total ? last.meta.page + 1 : undefined,
  });
  const branches = useInfiniteQuery({
    queryKey: ['branch-options'],
    initialPageParam: 1,
    staleTime: 0,
    retry: false,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.GET('/api/v1/branches', {
          params: { query: { page: pageParam, pageSize: 100, sortOrder: 'asc' } },
        }),
      ),
    getNextPageParam: (last) =>
      last.meta.page * last.meta.pageSize < last.meta.total ? last.meta.page + 1 : undefined,
  });
  function selected(ids: string[], id: string, checked: boolean) {
    return checked ? [...ids, id] : ids.filter((value) => value !== id);
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    const body = {
      email: String(form.get('email')).trim(),
      displayName: String(form.get('displayName')).trim(),
      roleIds,
      branchIds,
    };
    try {
      if (user)
        unwrap(
          await api.PATCH('/api/v1/users/{id}', {
            params: { ...(await csrfParams()), path: { id: user.id } },
            body,
          }),
        );
      else
        unwrap(
          await api.POST('/api/v1/users', {
            params: await csrfParams(),
            body: { ...body, temporaryPassword: String(form.get('temporaryPassword')) },
          }),
        );
      await onSave();
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="edit-panel">
      <h2>{user ? 'Sửa người dùng' : 'Tạo người dùng'}</h2>
      <form className="form-stack" onSubmit={save} aria-busy={pending}>
        <FormError error={error} />
        <label>
          Họ tên
          <Input name="displayName" defaultValue={user?.displayName} maxLength={200} required />
        </label>
        <label>
          Email
          <Input
            name="email"
            type="email"
            defaultValue={user?.email}
            maxLength={254}
            autoComplete="off"
            required
          />
        </label>
        {!user ? (
          <label>
            Mật khẩu tạm
            <Input
              name="temporaryPassword"
              type="password"
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              required
            />
            <span className="field-hint">Nhân viên phải đổi mật khẩu khi đăng nhập lần đầu.</span>
          </label>
        ) : null}
        <fieldset disabled={pending}>
          <legend>Vai trò · Đã chọn {roleIds.length}</legend>
          <FormError error={roles.error} />
          {roles.error ? (
            <Button type="button" onClick={() => void roles.refetch()}>
              Tải lại vai trò
            </Button>
          ) : null}
          {roles.data?.pages
            .flatMap((page) => page.data)
            .map((role) => (
              <label className="check-option" key={role.id}>
                <input
                  type="checkbox"
                  checked={roleIds.includes(role.id)}
                  onChange={(e) => setRoles(selected(roleIds, role.id, e.target.checked))}
                />
                {role.name}
              </label>
            ))}
          {roles.hasNextPage ? (
            <Button
              type="button"
              disabled={roles.isFetchingNextPage}
              onClick={() => void roles.fetchNextPage()}
            >
              Xem thêm vai trò
            </Button>
          ) : null}
        </fieldset>
        <fieldset disabled={pending}>
          <legend>Chi nhánh · Đã chọn {branchIds.length}</legend>
          <p className="field-hint">
            Vai trò theo chi nhánh cần ít nhất một chi nhánh hoạt động. Bỏ chọn chi nhánh ngừng hoạt
            động trước khi lưu.
          </p>
          <FormError error={branches.error} />
          {branches.error ? (
            <Button type="button" onClick={() => void branches.refetch()}>
              Tải lại chi nhánh
            </Button>
          ) : null}
          {branches.data?.pages
            .flatMap((page) => page.data)
            .map((branch) => (
              <label className="check-option" key={branch.id}>
                <input
                  type="checkbox"
                  checked={branchIds.includes(branch.id)}
                  disabled={branch.status !== 'ACTIVE' && !branchIds.includes(branch.id)}
                  onChange={(e) => setBranches(selected(branchIds, branch.id, e.target.checked))}
                />
                {branch.name}
                {branch.status === 'ACTIVE' ? '' : ' (Ngừng hoạt động)'}
              </label>
            ))}
          {branches.hasNextPage ? (
            <Button
              type="button"
              disabled={branches.isFetchingNextPage}
              onClick={() => void branches.fetchNextPage()}
            >
              Xem thêm chi nhánh
            </Button>
          ) : null}
        </fieldset>
        <div className="actions">
          <Button
            type="submit"
            disabled={
              pending ||
              roles.isPending ||
              branches.isPending ||
              !!roles.error ||
              !!branches.error ||
              roleIds.length === 0 ||
              roleIds.length > 10 ||
              branchIds.length > 100
            }
          >
            Lưu người dùng
          </Button>
          <button type="button" disabled={pending} onClick={onCancel}>
            Hủy
          </button>
        </div>
      </form>
    </section>
  );
}
