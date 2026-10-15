import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProductForm } from '../components/product-form';
import { VariantForm } from '../components/variant-form';
const state = vi.hoisted(() => ({ post: vi.fn(), patch: vi.fn() }));
vi.mock('../lib/auth/api', async (actual) => ({
  ...(await actual<typeof import('../lib/auth/api')>()),
  api: { POST: state.post, PATCH: state.patch },
  csrfParams: async () => ({ header: { 'X-CSRF-Token': 'signed-test' } }),
}));
beforeEach(() => {
  state.post.mockReset();
  state.patch.mockReset();
});
it('retains the create key and entered values when retrying an uncertain network result', async () => {
  state.post.mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce({
    response: new Response(null, { status: 201 }),
    data: { data: { id: 'created-product' } },
  });
  const saved = vi.fn();
  render(<ProductForm onSave={saved} onCancel={() => {}} />);
  await userEvent.type(screen.getByLabelText('Tên sản phẩm'), 'Sản phẩm thử');
  await userEvent.click(screen.getByRole('button', { name: 'Lưu sản phẩm' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Tên sản phẩm')).toHaveValue('Sản phẩm thử');
  await userEvent.click(screen.getByRole('button', { name: 'Lưu sản phẩm' }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  const first = state.post.mock.calls[0]![1],
    second = state.post.mock.calls[1]![1];
  expect(first.params.header['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
  expect(second.params.header['Idempotency-Key']).toBe(first.params.header['Idempotency-Key']);
  expect(second.body).toEqual(first.body);
});
it('sends exact price and quantity strings and displays duplicate SKU errors without clearing the form', async () => {
  state.post.mockResolvedValue({
    response: new Response(null, { status: 409 }),
    error: { error: { code: 'DUPLICATE_SKU', requestId: 'catalog-test' } },
  });
  render(<VariantForm productId="product" onSave={() => {}} onCancel={() => {}} />);
  await userEvent.type(screen.getByLabelText('SKU'), ' ab-01 ');
  await userEvent.type(screen.getByLabelText('Tên biến thể'), 'Size L');
  await userEvent.clear(screen.getByLabelText('Giá bán (VND)'));
  await userEvent.type(screen.getByLabelText('Giá bán (VND)'), '9007199254740993');
  await userEvent.clear(screen.getByLabelText('Ngưỡng cảnh báo tồn'));
  await userEvent.type(screen.getByLabelText('Ngưỡng cảnh báo tồn'), '0.125');
  await userEvent.click(screen.getByRole('button', { name: 'Lưu SKU' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('SKU đã tồn tại');
  expect(state.post).toHaveBeenCalledWith(
    '/api/v1/products/{id}/variants',
    expect.objectContaining({
      body: {
        sku: 'AB-01',
        name: 'Size L',
        sellingPrice: '9007199254740993',
        lowStockThreshold: '0.125',
      },
    }),
  );
  expect(screen.getByLabelText('Giá bán (VND)')).toHaveValue('9007199254740993');
});
it('prevents invalid fractional VND from being submitted', async () => {
  render(<VariantForm productId="product" onSave={() => {}} onCancel={() => {}} />);
  await userEvent.type(screen.getByLabelText('SKU'), 'VALID');
  await userEvent.type(screen.getByLabelText('Tên biến thể'), 'Variant');
  await userEvent.clear(screen.getByLabelText('Giá bán (VND)'));
  await userEvent.type(screen.getByLabelText('Giá bán (VND)'), '0.5');
  await userEvent.click(screen.getByRole('button', { name: 'Lưu SKU' }));
  expect(screen.getByLabelText('Giá bán (VND)')).toBeInvalid();
  expect(state.post).not.toHaveBeenCalled();
});
it('explains immutable SKU errors and retains the attempted edit', async () => {
  state.patch.mockResolvedValue({
    response: new Response(null, { status: 409 }),
    error: { error: { code: 'SKU_HAS_HISTORY', requestId: 'history-test' } },
  });
  const saved = vi.fn();
  render(
    <VariantForm
      productId="product"
      variant={{
        id: 'variant',
        productId: 'product',
        productName: 'Product',
        productStatus: 'ACTIVE',
        sku: 'OLD',
        name: 'Variant',
        sellingPrice: '123',
        lowStockThreshold: '0.000',
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }}
      onSave={saved}
      onCancel={() => {}}
    />,
  );
  await userEvent.clear(screen.getByLabelText('SKU'));
  await userEvent.type(screen.getByLabelText('SKU'), 'NEW');
  await userEvent.click(screen.getByRole('button', { name: 'Lưu SKU' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Không thể đổi SKU đã có lịch sử kho');
  expect(screen.getByLabelText('SKU')).toHaveValue('NEW');
  expect(saved).not.toHaveBeenCalled();
});
