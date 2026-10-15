import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoginForm } from '../app/login/login-form';
const state = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn(), replace: vi.fn() }));
vi.mock('../lib/auth/session', () => ({
  sessionKey: ['session'],
  useSession: () => ({ data: undefined, error: null, isPending: false }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: state.replace }),
  useSearchParams: () => new URLSearchParams('returnTo=%2Fworkspace'),
}));
vi.mock('../lib/auth/api', async (importActual) => ({
  ...(await importActual<typeof import('../lib/auth/api')>()),
  api: { POST: state.post, GET: state.get },
  csrfParams: async () => ({ header: { 'X-CSRF-Token': 'signed-test' } }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  state.get.mockResolvedValue({
    response: new Response(null, { status: 200 }),
    data: { data: { csrfToken: 'signed-test' } },
  });
});
function form() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LoginForm />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Mã tổ chức'), 'NEXUS');
  await user.type(screen.getByLabelText('Email', { exact: true }), 'owner@example.test');
  await user.type(screen.getByLabelText('Mật khẩu', { exact: true }), 'temporary-password');
}
it('validates required inputs and retains fields after an incorrect login with support ID', async () => {
  const user = form();
  await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
  expect(state.post).not.toHaveBeenCalled();
  state.post.mockResolvedValue({
    response: new Response(null, { status: 401 }),
    error: { error: { code: 'INVALID_CREDENTIALS', requestId: 'login-test-123' } },
  });
  await fill(user);
  await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('login-test-123');
  expect(screen.getByLabelText('Email', { exact: true })).toHaveValue('owner@example.test');
  expect(state.replace).not.toHaveBeenCalled();
});
it('disables duplicate submits and redirects temporary accounts to password change', async () => {
  const user = form();
  await fill(user);
  let finish!: () => void;
  state.post.mockReturnValue(
    new Promise((resolve) => {
      finish = () =>
        resolve({
          response: new Response(null, { status: 200 }),
          data: { data: { authenticated: true } },
        });
    }),
  );
  state.get.mockResolvedValue({
    response: new Response(null, { status: 200 }),
    data: { data: { mustChangePassword: true } },
  });
  await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
  expect(screen.getByRole('button', { name: 'Đang xử lý…' })).toBeDisabled();
  expect(state.post).toHaveBeenCalledOnce();
  finish();
  await waitFor(() => expect(state.replace).toHaveBeenCalledWith('/change-password'));
});
