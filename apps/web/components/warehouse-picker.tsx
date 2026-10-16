'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@nexus/ui/button';
import { Input } from '@nexus/ui/components/input';
import { api, unwrap } from '../lib/auth/api';
import { FormError } from './form-error';

export function WarehousePicker({
  value,
  onChange,
  activeOnly = false,
}: {
  value: string;
  onChange: (id: string) => void;
  activeOnly?: boolean;
}) {
  const [q, setQ] = useState(''),
    [page, setPage] = useState(1);
  const [chosen, setChosen] = useState<{ id: string; name: string }>();
  const query = useQuery({
    queryKey: ['warehouse-options', q, page, activeOnly],
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/warehouses', {
          params: { query: { q, page, pageSize: 20, status: activeOnly ? 'ACTIVE' : undefined } },
        }),
      ),
    retry: false,
  });
  const rows = query.data?.data ?? [];
  return (
    <div className="warehouse-picker">
      <label>
        Tìm kho
        <Input
          type="search"
          value={q}
          maxLength={100}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
      </label>
      <label>
        Kho
        <select
          value={value}
          onChange={(e) => {
            const row = rows.find((row) => row.id === e.target.value);
            setChosen(row);
            onChange(e.target.value);
          }}
        >
          <option value="">{activeOnly ? 'Chọn kho hoạt động' : 'Tất cả kho trong phạm vi'}</option>
          {value && !rows.some((row) => row.id === value) ? (
            <option value={value}>{chosen?.name ?? 'Kho đã chọn'}</option>
          ) : null}
          {rows.map((row) => (
            <option key={row.id} value={row.id}>
              {row.code} · {row.name} · {row.branchName}
              {row.status === 'INACTIVE' ? ' (đã ngừng)' : ''}
            </option>
          ))}
        </select>
      </label>
      <div className="actions">
        <Button
          type="button"
          disabled={page === 1 || query.isFetching}
          onClick={() => setPage(page - 1)}
        >
          Kho trước
        </Button>
        <Button
          type="button"
          disabled={page * 20 >= (query.data?.meta.total ?? 0) || query.isFetching}
          onClick={() => setPage(page + 1)}
        >
          Kho tiếp
        </Button>
        {query.isFetching ? (
          <span role="status">Đang tải kho…</span>
        ) : (
          <span>{query.data?.meta.total ?? 0} kho</span>
        )}
      </div>
      <FormError error={query.error} />
      {query.error ? (
        <Button type="button" onClick={() => void query.refetch()}>
          Thử tải kho lại
        </Button>
      ) : null}
    </div>
  );
}
