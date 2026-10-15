import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('web proxy reaches API and PostgreSQL through one origin', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Sẵn sàng');
  await expect(page.getByRole('status')).toContainText('Kết nối hoạt động');
  const response = await page.request.get('/api/v1/health/ready');
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).data.status).toBe('ready');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test('shared states support keyboard retry', async ({ page }) => {
  await page.goto('/showcase');
  const button = page.getByRole('button', { name: 'Thử lại' });
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Đã thử lại trạng thái mẫu.')).toBeVisible();
});
test('shell fits a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
});

test('network failures do not become support codes', async ({ page }) => {
  await page.route('**/api/v1/health/ready', (route) => route.abort('failed'));
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('Chưa kết nối được hệ thống', {
    timeout: 20000,
  });
  await expect(page.getByText('Mã hỗ trợ:', { exact: false })).toHaveCount(0);
});

test('valid API errors retain their correlated support code', async ({ page }) => {
  await page.route('**/api/v1/health/ready', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'DATABASE_UNAVAILABLE', requestId: 'support-test-001' },
      }),
    }),
  );
  await page.goto('/');
  await expect(page.getByText('Mã hỗ trợ: support-test-001')).toBeVisible({ timeout: 20000 });
});
