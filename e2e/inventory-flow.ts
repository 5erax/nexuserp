import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export async function verifyInventory(owner: Page, reviewer: Page) {
  const branches = await (await owner.request.get('/api/v1/branches?pageSize=100')).json();
  const branch = branches.data.find((row: { code: string }) => row.code === 'A');
  const csrf = (await owner.context().cookies()).find(
    (cookie) => cookie.name === 'nexus_csrf',
  )!.value;
  const created = await owner.request.post('/api/v1/warehouses', {
    headers: {
      Origin: new URL(owner.url()).origin,
      'X-CSRF-Token': csrf,
      'Idempotency-Key': randomUUID(),
    },
    data: { branchId: branch.id, code: 'E2E-STOCK', name: 'Kho kiểm thử tồn', isDefault: true },
  });
  expect(created.status()).toBe(201);
  const warehouse = (await created.json()).data;
  async function create(kind: string, rows: [string, string][]) {
    await owner.goto('/inventory');
    await owner.getByRole('button', { name: 'Tạo phiếu tồn kho', exact: true }).click();
    const form = owner.getByRole('heading', { name: 'Tạo phiếu tồn kho' }).locator('..');
    await form.getByRole('combobox', { name: 'Kho', exact: true }).selectOption(warehouse.id);
    await form.getByRole('combobox', { name: 'Loại phiếu', exact: true }).selectOption(kind);
    await form.getByLabel('Lý do', { exact: true }).fill('Kiểm kê cuối ngày');
    for (const [sku, quantity] of rows) {
      await form
        .getByRole('combobox', { name: 'SKU', exact: true })
        .selectOption({ label: sku === 'E2E-L' ? 'E2E-L · Size L đã cập nhật' : 'E2E-M · Size M' });
      await form.getByLabel('Số lượng thay đổi').fill(quantity);
      await form.getByRole('button', { name: 'Thêm vào phiếu' }).click();
    }
    await form.getByRole('button', { name: 'Tạo phiếu', exact: true }).click();
    return form;
  }
  let lost = false;
  const keys: string[] = [];
  await owner.route('**/api/v1/inventory/adjustments', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(route.request().headers()['idempotency-key']!);
    if (!lost) {
      lost = true;
      expect((await route.fetch()).status()).toBe(201);
      await route.abort('failed');
    } else await route.continue();
  });
  const form = await create('OPENING', [
    ['E2E-L', '11'],
    ['E2E-M', '1'],
  ]);
  await expect(form.getByRole('alert')).toContainText('Chưa kết nối');
  await expect(form.getByRole('textbox', { name: 'Lý do', exact: true })).toBeDisabled();
  await form.getByRole('button', { name: 'Tạo phiếu', exact: true }).click();
  await expect(owner).toHaveURL(/\/inventory\/adjustments\/[0-9a-f-]+$/);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await owner.unroute('**/api/v1/inventory/adjustments');
  const documentUrl = owner.url();
  await owner.getByRole('button', { name: 'Gửi phê duyệt' }).click();
  await expect(owner.getByText('Chờ phê duyệt', { exact: true })).toBeVisible();
  await expect(owner.getByRole('button', { name: 'Phê duyệt', exact: true })).toHaveCount(0);
  await reviewer.goto(documentUrl);
  await reviewer.getByRole('button', { name: 'Phê duyệt', exact: true }).click();
  await expect(reviewer.getByText('Đã phê duyệt', { exact: true })).toBeVisible();
  await owner.getByRole('button', { name: 'Cập nhật trạng thái' }).click();
  await owner.getByRole('button', { name: 'Ghi sổ', exact: true }).click();
  await expect(owner.getByText('Đã ghi sổ', { exact: true })).toBeVisible();
  await owner.getByRole('link', { name: 'Xem biến động từ phiếu này' }).click();
  await expect(
    owner.getByRole('region', { name: 'Biến động kho', exact: true }).getByRole('row'),
  ).toHaveCount(3);
  await owner.getByRole('button', { name: 'Số dư tồn kho', exact: true }).click();
  await expect(owner.getByRole('row').filter({ hasText: 'E2E-L' })).toContainText('11.000');
  await create('ADJUSTMENT', [['E2E-L', '-1']]);
  await owner.getByRole('button', { name: 'Ghi sổ', exact: true }).click();
  await expect(owner.getByText('Đã ghi sổ', { exact: true })).toBeVisible();
  await owner.getByRole('link', { name: 'Xem biến động từ phiếu này' }).click();
  await expect(owner.getByRole('row').filter({ hasText: 'E2E-L' })).toContainText('-1.000');
  await owner.setViewportSize({ width: 390, height: 844 });
  expect(
    await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  expect((await new AxeBuilder({ page: owner }).analyze()).violations).toEqual([]);
  await owner.screenshot({ path: 'test-results/inventory-mobile.png', fullPage: true });
  await owner.setViewportSize({ width: 1280, height: 720 });
  await owner.goto('/admin/users');
}
