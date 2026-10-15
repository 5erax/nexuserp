import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export async function verifyCatalog(owner: Page, reader: Page) {
  const stressName = 'SP-' + 'A'.repeat(197),
    name = 'Áo khoác hằng ngày';
  await owner.getByRole('link', { name: 'Sản phẩm', exact: true }).click();
  await owner.getByRole('button', { name: 'Tạo sản phẩm', exact: true }).click();
  await owner.getByLabel('Tên sản phẩm', { exact: true }).fill(stressName);
  await owner.getByLabel('Danh mục', { exact: true }).first().fill('Kiểm thử');
  await owner.getByLabel('Mô tả', { exact: true }).fill('Mô tả sản phẩm\nDòng thứ hai.');
  let lost = false;
  await owner.route('**/api/v1/products', async (route) => {
    if (!lost && route.request().method() === 'POST') {
      lost = true;
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      await route.abort('failed');
    } else await route.continue();
  });
  await owner.getByRole('button', { name: 'Lưu sản phẩm' }).click();
  await expect(owner.locator('form').getByRole('alert')).toContainText(
    'Chưa kết nối được hệ thống',
  );
  await expect(owner.getByLabel('Tên sản phẩm', { exact: true })).toHaveValue(stressName);
  await owner.getByRole('button', { name: 'Lưu sản phẩm' }).click();
  await expect(owner.getByRole('heading', { level: 1 })).toHaveText(stressName);
  await owner.unroute('**/api/v1/products');
  const detailUrl = owner.url();
  for (const [sku, label, price] of [
    ['E2E-L', 'Size L', '9007199254740993'],
    ['E2E-M', 'Size M', '450000'],
  ]) {
    await owner.getByRole('button', { name: 'Thêm SKU', exact: true }).click();
    await owner.getByLabel('SKU', { exact: true }).fill('E2E-L');
    await owner.getByLabel('Tên biến thể', { exact: true }).fill(label!);
    await owner.getByLabel('Giá bán (VND)', { exact: true }).fill(price!);
    await owner.getByLabel('Ngưỡng cảnh báo tồn', { exact: true }).fill('0.125');
    if (sku === 'E2E-M') {
      await owner.getByRole('button', { name: 'Lưu SKU', exact: true }).click();
      await expect(owner.locator('form').getByRole('alert')).toContainText('SKU đã tồn tại');
      await owner.getByLabel('SKU', { exact: true }).fill(sku);
    }
    await owner.getByRole('button', { name: 'Lưu SKU', exact: true }).click();
    await expect(owner.getByRole('row').filter({ hasText: sku! })).toContainText(label!);
  }
  const first = owner.getByRole('row').filter({ hasText: 'E2E-L' });
  await expect(first).toContainText('9.007.199.254.740.993');
  await first.getByRole('button', { name: 'Sửa SKU', exact: true }).click();
  await owner.getByLabel('Tên biến thể', { exact: true }).fill('Size L đã cập nhật');
  await owner.getByRole('button', { name: 'Lưu SKU', exact: true }).click();
  await expect(first).toContainText('Size L đã cập nhật');
  await owner.setViewportSize({ width: 390, height: 844 });
  expect(
    await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  expect((await new AxeBuilder({ page: owner }).analyze()).violations).toEqual([]);
  await owner.getByRole('button', { name: 'Lưu trữ sản phẩm', exact: true }).click();
  const dialog = owner.getByRole('dialog');
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBeTruthy();
  await owner.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await owner.setViewportSize({ width: 1280, height: 720 });
  await owner.getByRole('button', { name: 'Sửa sản phẩm', exact: true }).click();
  await owner.getByLabel('Tên sản phẩm', { exact: true }).fill(name);
  await owner.getByRole('button', { name: 'Lưu sản phẩm', exact: true }).click();
  await expect(owner.getByRole('heading', { level: 1 })).toHaveText(name);
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.getByRole('heading', { level: 1 }).click();
  await owner.screenshot({ path: 'test-results/catalog-mobile.png', fullPage: true });
  await owner.setViewportSize({ width: 1280, height: 720 });
  await reader.goto(detailUrl);
  await expect(reader.getByRole('heading', { level: 1 })).toHaveText(name);
  await expect(reader.getByRole('button', { name: 'Thêm SKU', exact: true })).toHaveCount(0);
  await expect(reader.getByRole('button', { name: 'Sửa sản phẩm', exact: true })).toHaveCount(0);
  await first.getByRole('button', { name: 'Lưu trữ SKU', exact: true }).click();
  await owner.getByRole('dialog').getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(first).toContainText('Đã lưu trữ');
  await owner.getByRole('combobox', { name: 'Trạng thái SKU', exact: true }).selectOption('ACTIVE');
  await expect(first).toHaveCount(0);
  await owner.getByRole('combobox', { name: 'Trạng thái SKU', exact: true }).selectOption('');
  await owner.getByRole('button', { name: 'Lưu trữ sản phẩm', exact: true }).click();
  await owner.getByRole('dialog').getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(owner.getByRole('button', { name: 'Thêm SKU', exact: true })).toBeDisabled();
  await owner.getByRole('link', { name: '← Sản phẩm', exact: true }).click();
  await owner.getByRole('combobox', { name: 'Trạng thái', exact: true }).selectOption('ACTIVE');
  await expect(owner.getByRole('link', { name, exact: true })).toHaveCount(0);
  await owner.getByRole('combobox', { name: 'Trạng thái', exact: true }).selectOption('INACTIVE');
  await owner.getByLabel('Tìm kiếm', { exact: true }).fill('E2E-M');
  await owner.getByRole('button', { name: 'Tìm', exact: true }).click();
  await expect(owner.getByRole('link', { name, exact: true })).toBeVisible();
  await expect(owner.getByLabel('Phân trang')).toContainText('1 bản ghi');
  await owner.getByRole('link', { name, exact: true }).click();
  await owner.getByRole('button', { name: 'Khôi phục sản phẩm', exact: true }).click();
  await owner.getByRole('dialog').getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(owner.getByRole('button', { name: 'Thêm SKU', exact: true })).toBeEnabled();
  await owner.goto('/admin/users');
  await expect(owner.getByRole('heading', { level: 1 })).toHaveText('Người dùng');
}
