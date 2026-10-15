import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('real login, required password change, shared-tab refresh and logout', async ({
  page,
  context,
}) => {
  const code = process.env.E2E_ORGANIZATION_CODE!,
    email = process.env.E2E_EMAIL!,
    password = process.env.E2E_PASSWORD!;
  expect(code).toBeTruthy();
  await page.goto('/workspace');
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await page.getByLabel('Mã tổ chức').fill(code);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill('incorrect-password');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('chưa đúng');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Mã hỗ trợ:');
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/\/change-password$/);
  await expect(page.getByRole('button', { name: 'Đăng xuất', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Mã tổ chức').fill(code);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/\/change-password$/);
  await page.getByLabel('Mật khẩu hiện tại', { exact: true }).fill(password);
  await page.getByLabel('Mật khẩu mới', { exact: true }).fill(password + '-changed');
  await page.getByLabel('Nhập lại mật khẩu mới', { exact: true }).fill(password + '-changed');
  await page.getByRole('button', { name: 'Đổi mật khẩu', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?changed=1$/);
  await page.getByLabel('Mã tổ chức').fill(code);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password + '-changed');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Business Owner');
  await page.goto('/login');
  await expect(page).toHaveURL(/\/workspace$/);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await context.clearCookies({ name: 'nexus_access' });
  const second = await context.newPage();
  let refreshes = 0;
  context.on('request', (req) => {
    if (req.url().endsWith('/auth/refresh') && req.method() === 'POST') refreshes++;
  });
  await Promise.all([page.reload(), second.goto('/workspace')]);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Business Owner');
  await expect(second.getByRole('heading', { level: 1 })).toHaveText('Business Owner');
  expect(refreshes).toBe(1);
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await second.reload();
  await expect(second).toHaveURL(/\/login\?returnTo=/);
  await page.goto('/change-password');
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await page.getByLabel('Mã tổ chức').fill(code);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password + '-changed');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/\/change-password$/);
});
test('login form works at 390px and reports rate limits without losing fields', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/v1/auth/csrf', (route) =>
    route.fulfill({
      status: 429,
      contentType: 'application/json',
      headers: { 'Retry-After': '30' },
      body: JSON.stringify({ error: { code: 'RATE_LIMITED', requestId: 'login-rate-test' } }),
    }),
  );
  await page.goto('/login');
  await page.getByLabel('Mã tổ chức').fill('NEXUS');
  await page.getByLabel('Email', { exact: true }).fill('user@example.test');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('synthetic-password');
  await expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('30 giây');
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('user@example.test');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
