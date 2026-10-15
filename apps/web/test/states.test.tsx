import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmptyState, ErrorState, LoadingState } from '@nexus/ui/states';
it('provides an accessible loading message', () => {
  render(<LoadingState label="Đang tải dữ liệu" />);
  expect(screen.getByRole('status')).toHaveTextContent('Đang tải dữ liệu');
});
it('explains empty data without invented records', () => {
  render(<EmptyState title="Chưa có đơn hàng" description="Đơn mới sẽ xuất hiện tại đây." />);
  expect(screen.getByText('Chưa có đơn hàng')).toBeVisible();
});
it('shows a support id and lets the user retry an error', async () => {
  const retry = vi.fn();
  render(<ErrorState requestId="req-123" onRetry={retry} />);
  expect(screen.getByRole('alert')).toHaveTextContent('req-123');
  await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  expect(retry).toHaveBeenCalledOnce();
});
