'use client';
import type { ReactNode } from 'react';
import { Button } from './button';
import { EmptyState, ErrorState, LoadingState } from './states';
export function DataTable<T extends { id: string }>({
  label,
  rows,
  columns,
  page,
  pageSize,
  total,
  onPageChange,
  pending,
  error,
  onRetry,
}: {
  label: string;
  rows: T[];
  columns: { id: string; title: string; cell: (row: T) => ReactNode }[];
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  pending: boolean;
  error?: { requestId?: string } | null;
  onRetry: () => void;
}) {
  if (pending) return <LoadingState />;
  if (error) return <ErrorState requestId={error.requestId} onRetry={onRetry} />;
  return (
    <>
      {rows.length ? (
        <div className="table-scroll" tabIndex={0} role="region" aria-label={label}>
          <table>
            <caption className="sr-only">{label}</caption>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.id} scope="col">
                    {c.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {columns.map((c) => (
                    <td key={c.id}>{c.cell(row)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="Chưa có dữ liệu"
          description="Thử thay đổi bộ lọc hoặc tạo bản ghi mới."
        />
      )}
      <nav className="table-pagination" aria-label="Phân trang">
        <span aria-live="polite">
          {total} bản ghi · Trang {page}/{Math.max(1, Math.ceil(total / pageSize))}
        </span>
        <Button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Trang trước
        </Button>
        <Button
          type="button"
          disabled={page * pageSize >= total}
          onClick={() => onPageChange(page + 1)}
        >
          Trang sau
        </Button>
      </nav>
    </>
  );
}
