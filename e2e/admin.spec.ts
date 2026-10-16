import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { bootstrapFixture } from './setup';
import { verifyCatalog } from './catalog-flow';
import { verifyInventory } from './inventory-flow';
async function login(page: Page, code: string, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Mã tổ chức').fill(code);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
}
async function changePassword(page: Page, password: string) {
  await expect(page).toHaveURL(/\/change-password$/);
  await page.getByLabel('Mật khẩu hiện tại', { exact: true }).fill(password);
  await page.getByLabel('Mật khẩu mới', { exact: true }).fill(password + '-changed');
  await page.getByLabel('Nhập lại mật khẩu mới', { exact: true }).fill(password + '-changed');
  await page.getByRole('button', { name: 'Đổi mật khẩu', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?changed=1$/);
}
test('administrator and scoped employee manage IAM and Catalog with confirmed changes and safe retries', async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  page.setDefaultTimeout(10000);
  const { code, email, password } = bootstrapFixture();
  await login(page, code, email, password);
  await changePassword(page, password);
  await login(page, code, email, password + '-changed');
  await expect(page).toHaveURL(/\/workspace$/);
  await page.getByRole('link', { name: 'Quản trị', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Người dùng');
  const owner = page.getByRole('row').filter({ hasText: email });
  await owner.getByRole('button', { name: 'Vô hiệu hóa', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('quản trị viên');
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Mã hỗ trợ:');
  await page.getByRole('button', { name: 'Đóng hộp thoại' }).click();
  await page.getByRole('link', { name: 'Chi nhánh', exact: true }).click();
  for (const [branchCode, name] of [
    ['A', 'Chi nhánh A'],
    ['B', 'Chi nhánh B'],
  ]) {
    await page.getByRole('button', { name: 'Tạo chi nhánh', exact: true }).click();
    await page.getByLabel('Mã chi nhánh', { exact: true }).fill(branchCode!);
    await page.getByLabel('Tên chi nhánh', { exact: true }).fill(name!);
    await page.getByRole('button', { name: 'Lưu chi nhánh' }).click();
    await expect(page.getByRole('cell', { name: name!, exact: true })).toBeVisible();
  }
  await page.getByRole('link', { name: 'Vai trò', exact: true }).click();
  await page.getByRole('button', { name: 'Tạo vai trò', exact: true }).click();
  await page.getByLabel('Mã vai trò', { exact: true }).fill('BRANCH_VIEW');
  await page.getByLabel('Tên vai trò', { exact: true }).fill('Xem chi nhánh');
  await page.getByRole('combobox', { name: 'Xem chi nhánh', exact: true }).selectOption('BRANCH');
  await page.getByRole('button', { name: 'Lưu quyền' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'BRANCH_VIEW' })).toContainText(
    'Xem chi nhánh',
  );
  await page.getByRole('link', { name: 'Người dùng', exact: true }).click();
  await page.getByRole('button', { name: 'Tạo người dùng', exact: true }).click();
  await page.getByLabel('Họ tên', { exact: true }).fill('Nhân viên A');
  await page.getByLabel('Email', { exact: true }).fill('staff@example.test');
  await page.getByLabel('Mật khẩu tạm', { exact: false }).fill('employee-temporary-password');
  await page.getByRole('checkbox', { name: 'Quản lý chi nhánh', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Chi nhánh A', exact: true }).check();
  await page.getByRole('button', { name: 'Lưu người dùng' }).click();
  const staff = page.getByRole('row').filter({ hasText: 'staff@example.test' });
  await expect(staff).toContainText('Nhân viên A');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 1280, height: 720 });
  const employeeContext = await browser.newContext();
  const employee = await employeeContext.newPage();
  await login(employee, code, 'staff@example.test', 'employee-temporary-password');
  await changePassword(employee, 'employee-temporary-password');
  await login(employee, code, 'staff@example.test', 'employee-temporary-password-changed');
  await expect(employee).toHaveURL(/\/workspace$/);
  await employee.goto('/admin/branches');
  await expect(employee.getByRole('cell', { name: 'Chi nhánh A', exact: true })).toBeVisible();
  await expect(employee.getByRole('cell', { name: 'Chi nhánh B', exact: true })).toHaveCount(0);
  await employee.goto('/admin/roles');
  await expect(employee).toHaveURL(/\/forbidden$/);
  // Reuse authenticated actors while respecting the real login IP quota.
  await verifyCatalog(page, employee);
  await verifyInventory(page, employee);
  await page.getByRole('link', { name: 'Chi nhánh', exact: true }).click();
  await page
    .getByRole('row')
    .filter({ hasText: 'Chi nhánh A' })
    .getByRole('button', { name: 'Ngừng hoạt động', exact: true })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'chi nhánh hoạt động khác',
  );
  await page.getByRole('button', { name: 'Đóng hộp thoại' }).click();
  await page.getByRole('link', { name: 'Người dùng', exact: true }).click();
  await staff.getByRole('button', { name: 'Vô hiệu hóa', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(staff).toContainText('Ngừng hoạt động');
  await employee.goto('/workspace');
  await expect(employee).toHaveURL(/\/login\?returnTo=/);
  await staff.getByRole('button', { name: 'Đặt lại mật khẩu', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByLabel('Mật khẩu tạm mới', { exact: false })
    .fill('reset-employee-password');
  await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'Tổ chức', exact: true }).click();
  await page.getByLabel('Tên tổ chức', { exact: true }).fill('Tổ chức đã cập nhật');
  await page.getByRole('button', { name: 'Lưu hồ sơ' }).click();
  await expect(page.getByRole('status')).toContainText('Đã lưu hồ sơ');
  await employeeContext.close();
});
