import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdjustmentPage from '../app/(protected)/inventory/adjustments/[id]/page';
const state = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn(), canPost: true }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'document' }) }));
vi.mock('../components/session-gate', () => ({
  SessionGate: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../lib/auth/session', () => ({
  useSession: () => ({
    data: {
      id: 'owner',
      branchIds: ['branch'],
      grants: state.canPost
        ? { 'inventory.adjustments.post': ['ORG'], 'inventory.adjustments.approve': ['ORG'] }
        : {},
    },
  }),
}));
vi.mock('../lib/auth/api', async (actual) => ({
  ...(await actual<typeof import('../lib/auth/api')>()),
  api: { POST: state.post, GET: state.get },
  csrfParams: async () => ({ header: { 'X-CSRF-Token': 'signed-test' } }),
}));
const draft = {
  id: 'document',
  warehouseName: 'Kho A',
  branchId: 'branch',
  createdBy: 'owner',
  status: 'DRAFT',
  kind: 'OPENING',
  reason: 'Kiểm kê',
  totalAbsoluteQuantity: '11.000',
  approvalThreshold: '10.000',
  requiresApproval: true,
  createdAt: '2026-10-16T00:00:00Z',
  approvedAt: null,
  decisionReason: null,
  itemCount: 1,
  items: [
    { id: 'item', sku: 'SKU-A', variantName: 'Size A', quantityDelta: '11.000', unitCost: null },
  ],
};
const ok = (data: unknown) => ({ response: new Response(null, { status: 200 }), data: { data } });
beforeEach(() => {
  state.post.mockReset();
  state.get.mockReset();
  state.canPost = true;
});
function setup() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AdjustmentPage />
    </QueryClientProvider>,
  );
}
it('retries an uncertain submit key then generates a new key after another actor approves', async () => {
  let current = { ...draft };
  state.get.mockImplementation(async () => ok(current));
  state.post
    .mockImplementationOnce(async () => {
      current = { ...draft, status: 'PENDING_APPROVAL' };
      throw new TypeError('lost response');
    })
    .mockImplementationOnce(async () => ok({ ...draft, status: 'PENDING_APPROVAL' }))
    .mockImplementationOnce(async () => {
      current = { ...draft, status: 'POSTED' };
      return ok(current);
    });
  setup();
  await userEvent.click(await screen.findByRole('button', { name: 'Gửi phê duyệt' }));
  await screen.findByRole('alert');
  current = { ...draft, status: 'APPROVED' };
  await userEvent.click(screen.getByRole('button', { name: 'Cập nhật trạng thái' }));
  await screen.findByText('Đã phê duyệt', { exact: true });
  await userEvent.click(screen.getByRole('button', { name: 'Thử lại thao tác' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Ghi sổ' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Ghi sổ' }));
  await screen.findByText('Đã ghi sổ', { exact: true });
  expect(state.post.mock.calls[1]![1].params.header['Idempotency-Key']).toBe(
    state.post.mock.calls[0]![1].params.header['Idempotency-Key'],
  );
  expect(state.post.mock.calls[2]![1].params.header['Idempotency-Key']).not.toBe(
    state.post.mock.calls[0]![1].params.header['Idempotency-Key'],
  );
});
it('hides self approval and stock writes from actors without their grants', async () => {
  state.canPost = false;
  state.get.mockResolvedValue(ok({ ...draft, status: 'PENDING_APPROVAL' }));
  setup();
  await screen.findByRole('heading', { name: 'Phiếu tồn đầu kỳ' });
  for (const name of ['Phê duyệt', 'Ghi sổ', 'Hủy phiếu', 'Từ chối phiếu'])
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
});
