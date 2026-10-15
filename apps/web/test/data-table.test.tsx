import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable } from '@nexus/ui/data-table';
const columns = [
  { id: 'name', title: 'Tên', cell: (row: { id: string; name: string }) => row.name },
];
it('renders semantic rows and keeps server pagination inside valid bounds', async () => {
  const change = vi.fn();
  render(
    <DataTable
      label="Nhân viên"
      rows={[{ id: 'one', name: 'Nguyễn Thị Ánh' }]}
      columns={columns}
      page={1}
      pageSize={20}
      total={21}
      onPageChange={change}
      pending={false}
      onRetry={() => {}}
    />,
  );
  expect(screen.getByRole('table')).toHaveAccessibleName('Nhân viên');
  expect(screen.getByRole('cell')).toHaveTextContent('Nguyễn Thị Ánh');
  expect(screen.getByRole('button', { name: 'Trang trước' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
  expect(change).toHaveBeenCalledWith(2);
});
it('does not show cached rows while scope/data loading fails', async () => {
  const retry = vi.fn();
  render(
    <DataTable
      label="Nhân viên"
      rows={[{ id: 'one', name: 'Must not appear' }]}
      columns={columns}
      page={1}
      pageSize={20}
      total={1}
      onPageChange={() => {}}
      pending={false}
      error={{ requestId: 'table-error' }}
      onRetry={retry}
    />,
  );
  expect(screen.queryByText('Must not appear')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('table-error');
  await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  expect(retry).toHaveBeenCalledOnce();
});
