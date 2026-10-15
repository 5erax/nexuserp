'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@nexus/contracts';
import { Button } from '@nexus/ui/button';
import { Input } from '@nexus/ui/components/input';
import { DataTable } from '@nexus/ui/data-table';
import { api, ApiFailure, unwrap } from '../../../../lib/auth/api';
import { useSession } from '../../../../lib/auth/session';
import { SessionGate } from '../../../../components/session-gate';
import { ListTools } from '../../../../components/list-tools';
import { ProductForm } from '../../../../components/product-form';

type Product = components['schemas']['ProductData'];
export default function ProductsPage() {
  return (
    <SessionGate permission="catalog.products.read">
      <Products />
    </SessionGate>
  );
}
function Products() {
  const router = useRouter(),
    client = useQueryClient(),
    { data: actor } = useSession();
  const [page, setPage] = useState(1),
    [q, setQ] = useState(''),
    [category, setCategory] = useState(''),
    [filterCategory, setFilterCategory] = useState('');
  const [status, setStatus] = useState<'' | 'ACTIVE' | 'INACTIVE'>(''),
    [sortBy, setSortBy] = useState<'createdAt' | 'name'>('createdAt'),
    [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc'),
    [creating, setCreating] = useState(false);
  const query = useQuery({
    queryKey: ['products', page, q, filterCategory, status, sortBy, sortOrder],
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/products', {
          params: {
            query: {
              page,
              pageSize: 20,
              q,
              category: filterCategory || undefined,
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
  return (
    <div className="catalog-content">
      <div className="page-heading">
        <h1>Sản phẩm</h1>
        <p>Danh mục và SKU dùng chung trong tổ chức.</p>
      </div>
      {canManage && !creating ? (
        <Button onClick={() => setCreating(true)}>Tạo sản phẩm</Button>
      ) : null}
      {canManage && creating ? (
        <section className="edit-panel">
          <h2>Tạo sản phẩm</h2>
          <ProductForm
            onCancel={() => setCreating(false)}
            onSave={(product) => {
              void client.invalidateQueries({ queryKey: ['products'] });
              router.push('/catalog/products/' + product.id);
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
          setFilterCategory(category.trim());
          setPage(1);
        }}
      >
        <label>
          Danh mục
          <Input value={category} onChange={(e) => setCategory(e.target.value)} maxLength={100} />
        </label>
        <label>
          Trạng thái
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
            <option value="name">Tên sản phẩm</option>
          </select>
        </label>
      </ListTools>
      <DataTable<Product>
        label="Danh sách sản phẩm"
        rows={query.data?.data ?? []}
        columns={[
          {
            id: 'name',
            title: 'Sản phẩm',
            cell: (p) => <Link href={'/catalog/products/' + p.id}>{p.name}</Link>,
          },
          { id: 'category', title: 'Danh mục', cell: (p) => p.category ?? 'Chưa phân loại' },
          {
            id: 'status',
            title: 'Trạng thái',
            cell: (p) => (p.status === 'ACTIVE' ? 'Đang kinh doanh' : 'Đã lưu trữ'),
          },
        ]}
        page={page}
        pageSize={20}
        total={query.data?.meta.total ?? 0}
        onPageChange={setPage}
        pending={query.isPending}
        error={
          query.error
            ? { requestId: query.error instanceof ApiFailure ? query.error.requestId : undefined }
            : undefined
        }
        onRetry={() => void query.refetch()}
      />
    </div>
  );
}
