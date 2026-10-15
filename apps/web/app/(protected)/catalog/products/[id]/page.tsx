'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@nexus/contracts';
import { Button } from '@nexus/ui/button';
import { DataTable } from '@nexus/ui/data-table';
import { LoadingState } from '@nexus/ui/states';
import { api, ApiFailure, unwrap } from '../../../../../lib/auth/api';
import { useSession } from '../../../../../lib/auth/session';
import { SessionGate } from '../../../../../components/session-gate';
import { FormError } from '../../../../../components/form-error';
import { ListTools } from '../../../../../components/list-tools';
import { ProductForm } from '../../../../../components/product-form';
import { VariantForm } from '../../../../../components/variant-form';
import {
  CatalogStatusDialog,
  type CatalogStatusTarget,
} from '../../../../../components/catalog-status-dialog';
type Variant = components['schemas']['VariantData'];
const vnd = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});
export default function ProductPage() {
  return (
    <SessionGate permission="catalog.products.read">
      <ProductDetail />
    </SessionGate>
  );
}
function ProductDetail() {
  const { id } = useParams<{ id: string }>(),
    client = useQueryClient(),
    { data: actor } = useSession();
  const [editing, setEditing] = useState(false),
    [variant, setVariant] = useState<Variant | null | undefined>(),
    [target, setTarget] = useState<CatalogStatusTarget>();
  const [page, setPage] = useState(1),
    [q, setQ] = useState(''),
    [status, setStatus] = useState<'' | 'ACTIVE' | 'INACTIVE'>('');
  const [sortBy, setSortBy] = useState<'createdAt' | 'name' | 'sku' | 'sellingPrice'>('createdAt'),
    [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const product = useQuery({
    queryKey: ['products', id],
    queryFn: async () =>
      unwrap(await api.GET('/api/v1/products/{id}', { params: { path: { id } } })),
    retry: false,
  });
  const variants = useQuery({
    queryKey: ['product-variants', id, page, q, status, sortBy, sortOrder],
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/product-variants', {
          params: {
            query: {
              productId: id,
              page,
              pageSize: 20,
              q,
              status: status || undefined,
              sortBy,
              sortOrder,
            },
          },
        }),
      ),
    retry: false,
  });
  const canManage = actor?.grants['catalog.products.manage']?.includes('ORG');
  function refresh() {
    setPage(1);
    void client.invalidateQueries({ queryKey: ['products'] });
    void client.invalidateQueries({ queryKey: ['product-variants'] });
  }
  if (product.isPending) return <LoadingState />;
  if (product.error || !product.data)
    return (
      <>
        <Link href="/catalog/products">← Sản phẩm</Link>
        <FormError error={product.error} />
        <Button onClick={() => void product.refetch()}>Thử lại</Button>
      </>
    );
  const data = product.data.data;
  return (
    <div className="catalog-content">
      <Link href="/catalog/products">← Sản phẩm</Link>
      <div className="page-heading">
        <h1>{data.name}</h1>
        <p>
          {data.category ?? 'Chưa phân loại'} ·{' '}
          {data.status === 'ACTIVE' ? 'Đang kinh doanh' : 'Đã lưu trữ'}
        </p>
      </div>
      {data.description ? <p className="catalog-description">{data.description}</p> : null}
      {canManage ? (
        <div className="actions">
          <Button onClick={() => setEditing(true)}>Sửa sản phẩm</Button>
          <Button
            onClick={() => setTarget({ kind: 'product', id, name: data.name, status: data.status })}
          >
            {data.status === 'ACTIVE' ? 'Lưu trữ sản phẩm' : 'Khôi phục sản phẩm'}
          </Button>
        </div>
      ) : null}
      {canManage && editing ? (
        <section className="edit-panel">
          <h2>Sửa sản phẩm</h2>
          <ProductForm
            product={data}
            onCancel={() => setEditing(false)}
            onSave={() => {
              setEditing(false);
              refresh();
            }}
          />
        </section>
      ) : null}
      <section className="catalog-variants" aria-labelledby="variants-heading">
        <h2 id="variants-heading">Biến thể và SKU</h2>
        {data.status === 'INACTIVE' ? (
          <p>
            Sản phẩm đã lưu trữ. Các SKU được giữ để tra cứu lịch sử; khôi phục sản phẩm trước khi
            thêm SKU.
          </p>
        ) : null}
        {canManage && variant === undefined ? (
          <Button disabled={data.status !== 'ACTIVE'} onClick={() => setVariant(null)}>
            Thêm SKU
          </Button>
        ) : null}
        {canManage && variant !== undefined ? (
          <section className="edit-panel">
            <h3>{variant ? 'Sửa SKU' : 'Thêm SKU'}</h3>
            <VariantForm
              key={variant?.id ?? 'new'}
              productId={id}
              variant={variant ?? undefined}
              onCancel={() => setVariant(undefined)}
              onSave={() => {
                setVariant(undefined);
                refresh();
              }}
            />
          </section>
        ) : null}
        <ListTools
          orderLabels={['Giảm dần', 'Tăng dần']}
          sortOrder={sortOrder}
          onSort={(value) => {
            setSortOrder(value);
            setPage(1);
          }}
          onSearch={(value) => {
            setQ(value);
            setPage(1);
          }}
        >
          <label>
            Trạng thái SKU
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as typeof status);
                setPage(1);
              }}
            >
              <option value="">Tất cả</option>
              <option value="ACTIVE">Đang kinh doanh</option>
              <option value="INACTIVE">Đã lưu trữ</option>
            </select>
          </label>
          <label>
            Sắp xếp theo
            <select
              value={sortBy}
              onChange={(e) => {
                setSortBy(e.target.value as typeof sortBy);
                setPage(1);
              }}
            >
              <option value="createdAt">Ngày tạo</option>
              <option value="sku">SKU</option>
              <option value="name">Tên biến thể</option>
              <option value="sellingPrice">Giá bán</option>
            </select>
          </label>
        </ListTools>
        <DataTable<Variant>
          label="Danh sách SKU"
          rows={variants.data?.data ?? []}
          columns={[
            { id: 'sku', title: 'SKU', cell: (v) => v.sku },
            { id: 'name', title: 'Tên biến thể', cell: (v) => v.name },
            { id: 'price', title: 'Giá bán', cell: (v) => vnd.format(BigInt(v.sellingPrice)) },
            { id: 'threshold', title: 'Ngưỡng tồn', cell: (v) => v.lowStockThreshold },
            {
              id: 'status',
              title: 'Trạng thái',
              cell: (v) =>
                v.status === 'INACTIVE'
                  ? 'Đã lưu trữ'
                  : v.productStatus === 'INACTIVE'
                    ? 'Sản phẩm đã lưu trữ'
                    : 'Đang kinh doanh',
            },
            ...(canManage
              ? [
                  {
                    id: 'actions',
                    title: 'Thao tác',
                    cell: (v: Variant) => (
                      <div className="actions">
                        <Button onClick={() => setVariant(v)}>Sửa SKU</Button>
                        <Button
                          onClick={() =>
                            setTarget({ kind: 'variant', id: v.id, name: v.sku, status: v.status })
                          }
                        >
                          {v.status === 'ACTIVE' ? 'Lưu trữ SKU' : 'Khôi phục SKU'}
                        </Button>
                      </div>
                    ),
                  },
                ]
              : []),
          ]}
          page={page}
          pageSize={20}
          total={variants.data?.meta.total ?? 0}
          onPageChange={setPage}
          pending={variants.isPending}
          error={
            variants.error
              ? {
                  requestId:
                    variants.error instanceof ApiFailure ? variants.error.requestId : undefined,
                }
              : undefined
          }
          onRetry={() => void variants.refetch()}
        />
      </section>
      {target ? (
        <CatalogStatusDialog
          target={target}
          onClose={() => setTarget(undefined)}
          onSave={() => {
            setTarget(undefined);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}
