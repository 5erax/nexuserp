'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { components } from '@nexus/contracts';
import { Button } from '@nexus/ui/button';
import { Input } from '@nexus/ui/components/input';
import { DataTable } from '@nexus/ui/data-table';
import { EmptyState, LoadingState } from '@nexus/ui/states';
import { SessionGate } from '../../../components/session-gate';
import { WarehousePicker } from '../../../components/warehouse-picker';
import { AdjustmentForm } from '../../../components/adjustment-form';
import { FormError } from '../../../components/form-error';
import { api, ApiFailure, unwrap } from '../../../lib/auth/api';
import { useSession } from '../../../lib/auth/session';
import { adjustmentStatuses, movementTypes } from '../../../lib/inventory';

export default function InventoryPage() {
  return (
    <SessionGate>
      <Inventory />
    </SessionGate>
  );
}
function Inventory() {
  const search = useSearchParams(),
    router = useRouter(),
    { data: actor } = useSession();
  const has = (permission: string) =>
    actor?.grants[permission]?.some((scope) => scope === 'ORG' || scope === 'BRANCH');
  const tabs = [
    { id: 'balances', title: 'Số dư tồn kho', allowed: has('inventory.balances.read') },
    { id: 'movements', title: 'Biến động kho', allowed: has('inventory.movements.read') },
    { id: 'adjustments', title: 'Phiếu tồn kho', allowed: has('inventory.movements.read') },
  ];
  const [view, setView] = useState(
    search.get('view') ?? tabs.find((tab) => tab.allowed)?.id ?? 'balances',
  );
  const [warehouseId, setWarehouse] = useState(''),
    [q, setQ] = useState(''),
    [page, setPage] = useState(1),
    [creating, setCreating] = useState(false);
  const [referenceId, setReference] = useState(search.get('referenceId') ?? ''),
    [referenceType, setType] = useState<'' | keyof typeof movementTypes>('');
  const [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [status, setStatus] = useState<'' | keyof typeof adjustmentStatuses>('');
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const allowed = !!tabs.find((tab) => tab.id === view)?.allowed;
  const balances = useQuery({
    queryKey: ['inventory', 'balances', page, warehouseId, q],
    enabled: allowed && view === 'balances',
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/inventory/balances', {
          params: { query: { page, pageSize: 20, warehouseId: warehouseId || undefined, q } },
        }),
      ),
    retry: false,
  });
  const movements = useQuery({
    queryKey: [
      'inventory',
      'movements',
      cursors.at(-1),
      warehouseId,
      q,
      referenceId,
      referenceType,
      from,
      to,
    ],
    enabled: allowed && view === 'movements',
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/inventory/movements', {
          params: {
            query: {
              limit: 20,
              cursor: cursors.at(-1),
              warehouseId: warehouseId || undefined,
              q,
              referenceId: referenceId || undefined,
              referenceType: referenceType || undefined,
              from: from ? from + 'T00:00:00.000Z' : undefined,
              to: to ? to + 'T23:59:59.999Z' : undefined,
            },
          },
        }),
      ),
    retry: false,
  });
  const adjustments = useQuery({
    queryKey: ['inventory', 'adjustments', page, warehouseId, q, status],
    enabled: allowed && view === 'adjustments',
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/inventory/adjustments', {
          params: {
            query: {
              page,
              pageSize: 20,
              warehouseId: warehouseId || undefined,
              q,
              status: status || undefined,
            },
          },
        }),
      ),
    retry: false,
  });
  const reset = () => {
    setPage(1);
    setCursors([undefined]);
  };
  if (!tabs.some((tab) => tab.allowed))
    return <p role="alert">Bạn chưa được cấp quyền xem tồn kho.</p>;
  return (
    <div className="catalog-content inventory-content">
      <div className="page-heading">
        <h1>Tồn kho</h1>
        <p>Tra cứu lượng khả dụng, truy vết biến động và ghi nhận kiểm kê có phê duyệt.</p>
      </div>
      <nav className="admin-tabs" aria-label="Nghiệp vụ tồn kho">
        {tabs
          .filter((tab) => tab.allowed)
          .map((tab) => (
            <Button
              key={tab.id}
              aria-pressed={view === tab.id}
              onClick={() => {
                setView(tab.id);
                reset();
                setQ('');
                setReference('');
              }}
            >
              {tab.title}
            </Button>
          ))}
      </nav>
      {has('inventory.adjustments.create') && has('inventory.movements.read') && !creating ? (
        <Button onClick={() => setCreating(true)}>Tạo phiếu tồn kho</Button>
      ) : null}
      {creating ? (
        <section className="edit-panel">
          <AdjustmentForm
            onCancel={() => setCreating(false)}
            onSave={(id) => router.push('/inventory/adjustments/' + id)}
          />
        </section>
      ) : null}
      {!allowed ? (
        <p role="alert">
          Bạn chưa có quyền xem mục này. Chọn một nghiệp vụ được cấp quyền phía trên.
        </p>
      ) : (
        <>
          <WarehousePicker
            value={warehouseId}
            onChange={(id) => {
              setWarehouse(id);
              reset();
            }}
          />
          <form
            key={view}
            className="list-tools"
            onSubmit={(event) => {
              event.preventDefault();
              setQ(String(new FormData(event.currentTarget).get('q') ?? '').trim());
              reset();
            }}
          >
            <label>
              Tìm kiếm
              <Input name="q" type="search" maxLength={100} />
            </label>
            <Button type="submit">Tìm</Button>
            {view === 'adjustments' ? (
              <label>
                Trạng thái phiếu
                <select
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value as typeof status);
                    reset();
                  }}
                >
                  <option value="">Tất cả</option>
                  {Object.entries(adjustmentStatuses).map(([value, title]) => (
                    <option key={value} value={value}>
                      {title}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {view === 'movements' ? (
              <>
                <label>
                  Loại biến động
                  <select
                    value={referenceType}
                    onChange={(e) => {
                      setType(e.target.value as typeof referenceType);
                      reset();
                    }}
                  >
                    <option value="">Tất cả</option>
                    {Object.entries(movementTypes).map(([value, title]) => (
                      <option key={value} value={value}>
                        {title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Từ ngày (UTC)
                  <Input
                    type="date"
                    value={from}
                    onChange={(e) => {
                      setFrom(e.target.value);
                      reset();
                    }}
                  />
                </label>
                <label>
                  Đến ngày (UTC)
                  <Input
                    type="date"
                    value={to}
                    onChange={(e) => {
                      setTo(e.target.value);
                      reset();
                    }}
                  />
                </label>
                {referenceId ? (
                  <Button
                    type="button"
                    onClick={() => {
                      setReference('');
                      reset();
                    }}
                  >
                    Bỏ lọc phiếu
                  </Button>
                ) : null}
              </>
            ) : null}
          </form>
          {view === 'balances' ? (
            <DataTable<components['schemas']['BalanceData']>
              label="Số dư tồn kho"
              rows={balances.data?.data ?? []}
              columns={[
                { id: 'sku', title: 'SKU', cell: (row) => row.sku },
                { id: 'warehouse', title: 'Kho', cell: (row) => row.warehouseName },
                { id: 'onHand', title: 'Tồn vật lý', cell: (row) => row.onHand },
                { id: 'reserved', title: 'Đã giữ', cell: (row) => row.reserved },
                {
                  id: 'available',
                  title: 'Khả dụng',
                  cell: (row) => (
                    <>
                      {row.available}
                      {row.lowStock ? (
                        <strong className="stock-warning">
                          {' '}
                          · Tồn thấp (ngưỡng {row.lowStockThreshold})
                        </strong>
                      ) : null}
                    </>
                  ),
                },
              ]}
              page={page}
              pageSize={20}
              total={balances.data?.meta.total ?? 0}
              onPageChange={setPage}
              pending={balances.isPending}
              error={
                balances.error
                  ? {
                      requestId:
                        balances.error instanceof ApiFailure ? balances.error.requestId : undefined,
                    }
                  : undefined
              }
              onRetry={() => void balances.refetch()}
            />
          ) : null}
          {view === 'adjustments' ? (
            <DataTable<components['schemas']['AdjustmentSummary']>
              label="Phiếu tồn kho"
              rows={adjustments.data?.data ?? []}
              columns={[
                {
                  id: 'type',
                  title: 'Phiếu',
                  cell: (row) => (
                    <Link href={'/inventory/adjustments/' + row.id}>
                      {row.kind === 'OPENING' ? 'Tồn đầu kỳ' : 'Điều chỉnh'}
                    </Link>
                  ),
                },
                { id: 'warehouse', title: 'Kho', cell: (row) => row.warehouseName },
                { id: 'reason', title: 'Lý do', cell: (row) => row.reason },
                {
                  id: 'status',
                  title: 'Trạng thái',
                  cell: (row) => adjustmentStatuses[row.status] ?? row.status,
                },
                { id: 'count', title: 'Số SKU', cell: (row) => row.itemCount },
              ]}
              page={page}
              pageSize={20}
              total={adjustments.data?.meta.total ?? 0}
              onPageChange={setPage}
              pending={adjustments.isPending}
              error={
                adjustments.error
                  ? {
                      requestId:
                        adjustments.error instanceof ApiFailure
                          ? adjustments.error.requestId
                          : undefined,
                    }
                  : undefined
              }
              onRetry={() => void adjustments.refetch()}
            />
          ) : null}
          {view === 'movements' ? (
            movements.isPending ? (
              <LoadingState />
            ) : movements.error ? (
              <>
                <FormError error={movements.error} />
                <Button onClick={() => void movements.refetch()}>Thử lại</Button>
              </>
            ) : (
              <>
                {movements.data?.data.length ? (
                  <div
                    className="table-scroll"
                    role="region"
                    aria-label="Biến động kho"
                    tabIndex={0}
                  >
                    <table>
                      <caption className="sr-only">Biến động kho</caption>
                      <thead>
                        <tr>
                          <th scope="col">Thời điểm</th>
                          <th scope="col">SKU / Kho</th>
                          <th scope="col">Loại</th>
                          <th scope="col">Thay đổi</th>
                          <th scope="col">Chứng từ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {movements.data.data.map((row) => (
                          <tr key={row.id}>
                            <td>{new Date(row.createdAt).toLocaleString('vi-VN')}</td>
                            <td>
                              {row.sku}
                              <br />
                              {row.warehouseName}
                            </td>
                            <td>{movementTypes[row.referenceType]}</td>
                            <td>{row.quantityDelta}</td>
                            <td>
                              {row.referenceType === 'SHIPMENT_OUT' ? (
                                'Phiếu giao hàng'
                              ) : (
                                <Link href={'/inventory/adjustments/' + row.referenceId}>
                                  Xem phiếu
                                </Link>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState
                    title="Chưa có biến động"
                    description="Chọn kho/SKU khác hoặc ghi sổ một phiếu tồn kho."
                  />
                )}
                <nav className="table-pagination" aria-label="Phân trang biến động">
                  <Button
                    disabled={cursors.length === 1 || movements.isFetching}
                    onClick={() => setCursors(cursors.slice(0, -1))}
                  >
                    Trang trước
                  </Button>
                  <span>Trang {cursors.length}</span>
                  <Button
                    disabled={!movements.data?.meta.nextCursor || movements.isFetching}
                    onClick={() => {
                      const next = movements.data?.meta.nextCursor;
                      if (next) setCursors([...cursors, next]);
                    }}
                  >
                    Trang sau
                  </Button>
                </nav>
              </>
            )
          ) : null}
        </>
      )}
    </div>
  );
}
