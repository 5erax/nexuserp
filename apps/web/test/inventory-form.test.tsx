import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdjustmentForm } from '../components/adjustment-form';
const state = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock('../lib/auth/api', async (actual) => ({
  ...(await actual<typeof import('../lib/auth/api')>()),
  api: { POST: state.post, GET: state.get },
  csrfParams: async () => ({ header: { 'X-CSRF-Token': 'signed-test' } }),
}));
vi.mock('../components/warehouse-picker', () => ({
  WarehousePicker: ({ value, onChange }: { value: string; onChange: (id: string) => void }) => (
    <label>
      Kho
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Chọn kho</option>
        <option value="warehouse">Kho A</option>
      </select>
    </label>
  ),
}));
function setup() {
  const saved = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AdjustmentForm onSave={saved} onCancel={() => {}} />
    </QueryClientProvider>,
  );
  return saved;
}
beforeEach(() => {
  state.post.mockReset();
  state.get.mockReset();
  state.get.mockResolvedValue({
    response: new Response(null, { status: 200 }),
    data: {
      data: [
        { id: 'variant-a', sku: 'SKU-A', name: 'Size A' },
        { id: 'variant-b', sku: 'SKU-B', name: 'Size B' },
      ],
      meta: { total: 2 },
    },
  });
});
async function line(sku: string, quantity: string, cost = '') {
  await screen.findByRole('option', { name: /SKU-A/ });
  await userEvent.selectOptions(await screen.findByLabelText('SKU', { exact: true }), sku);
  await userEvent.clear(screen.getByLabelText('Số lượng thay đổi'));
  await userEvent.type(screen.getByLabelText('Số lượng thay đổi'), quantity);
  const input = screen.getByLabelText('Giá nhập mỗi đơn vị (để trống nếu chưa biết)');
  await userEvent.clear(input);
  if (cost) await userEvent.type(input, cost);
  await userEvent.click(screen.getByRole('button', { name: 'Thêm vào phiếu' }));
}
it('retains the exact multi-SKU command and key after a lost response and locks uncertain edits', async () => {
  state.post.mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce({
    response: new Response(null, { status: 201 }),
    data: { data: { id: 'created' } },
  });
  const saved = setup();
  await userEvent.selectOptions(screen.getByLabelText('Kho', { exact: true }), 'warehouse');
  await userEvent.type(screen.getByLabelText('Lý do', { exact: true }), 'Kiểm kê');
  await line('variant-a', '0.125');
  await line('variant-b', '1', '0');
  await userEvent.click(screen.getByRole('button', { name: 'Tạo phiếu' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Lý do', { exact: true })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Tạo phiếu' }));
  await waitFor(() => expect(saved).toHaveBeenCalledWith('created'));
  const first = state.post.mock.calls[0]![1],
    second = state.post.mock.calls[1]![1];
  expect(second).toEqual(first);
  expect(first.params.header['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
  expect(first.body.items).toEqual([
    { variantId: 'variant-a', quantityDelta: '0.125', unitCost: null },
    { variantId: 'variant-b', quantityDelta: '1', unitCost: '0' },
  ]);
});
it('rejects invalid signs/precision, duplicate SKU and outbound cost before create', async () => {
  setup();
  await line('variant-a', '-1');
  expect(await screen.findByRole('alert')).toHaveTextContent('Tồn đầu kỳ phải dương');
  await userEvent.selectOptions(screen.getByLabelText('Loại phiếu'), 'ADJUSTMENT');
  await line('variant-a', '-1.125', '0');
  expect(screen.getByRole('alert')).toHaveTextContent('dòng giảm tồn không có giá nhập');
  await line('variant-a', '-1.125');
  expect(screen.getByText('1/100 SKU trong phiếu')).toBeVisible();
  await line('variant-a', '1');
  expect(screen.getByText('1/100 SKU trong phiếu')).toBeVisible();
  await line('variant-b', '0.0001');
  expect(screen.getByText('1/100 SKU trong phiếu')).toBeVisible();
  expect(state.post).not.toHaveBeenCalled();
});
