import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UserForm } from '../components/user-form';
const state = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock('../lib/auth/api', async (actual) => ({
  ...(await actual<typeof import('../lib/auth/api')>()),
  api: { GET: state.get, PATCH: state.patch },
  csrfParams: async () => ({ header: { 'X-CSRF-Token': 'signed-test' } }),
}));
it('keeps assigned roles and branches that are outside the first lookup page', async () => {
  state.get.mockImplementation(async (path: string) => ({
    response: new Response(null, { status: 200 }),
    data: {
      data: path.endsWith('/roles')
        ? [{ id: 'visible-role', code: 'VISIBLE', name: 'Vai trò khác' }]
        : [{ id: 'visible-branch', name: 'Chi nhánh khác', status: 'ACTIVE' }],
      meta: { page: 1, pageSize: 100, total: 101 },
    },
  }));
  state.patch.mockResolvedValue({
    response: new Response(null, { status: 200 }),
    data: { data: {} },
  });
  const saved = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UserForm
        user={{
          id: 'user',
          email: 'user@example.test',
          displayName: 'Nhân viên',
          status: 'ACTIVE',
          mustChangePassword: false,
          createdAt: new Date().toISOString(),
          roles: [{ id: 'hidden-role', code: 'HIDDEN', name: 'Vai trò đã cấp' }],
          branchIds: ['hidden-branch'],
        }}
        onSave={saved}
        onCancel={() => {}}
      />
    </QueryClientProvider>,
  );
  await screen.findByRole('checkbox', { name: 'Chi nhánh khác' });
  await userEvent.click(screen.getByRole('button', { name: 'Lưu người dùng' }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(state.patch).toHaveBeenCalledWith(
    '/api/v1/users/{id}',
    expect.objectContaining({
      body: expect.objectContaining({ roleIds: ['hidden-role'], branchIds: ['hidden-branch'] }),
    }),
  );
});
