'use client';
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { components } from '@nexus/contracts';
import { Button } from '@nexus/ui/button';
import { Input } from '@nexus/ui/components/input';
import { api, ApiFailure, csrfParams, unwrap } from '../lib/auth/api';
import { WarehousePicker } from './warehouse-picker';
import { FormError } from './form-error';

type Line = { variantId: string; sku: string; quantityDelta: string; unitCost: string | null };
type Body = components['schemas']['CreateAdjustmentInput'];
export function AdjustmentForm({
  onSave,
  onCancel,
}: {
  onSave: (id: string) => void;
  onCancel: () => void;
}) {
  const [warehouseId, setWarehouse] = useState(''),
    [kind, setKind] = useState<'OPENING' | 'ADJUSTMENT'>('OPENING');
  const [reason, setReason] = useState(''),
    [q, setQ] = useState(''),
    [page, setPage] = useState(1);
  const [variantId, setVariant] = useState(''),
    [quantity, setQuantity] = useState('1'),
    [cost, setCost] = useState('');
  const [lines, setLines] = useState<Line[]>([]),
    [pending, setPending] = useState(false),
    [error, setError] = useState<unknown>(),
    [validation, setValidation] = useState('');
  const [locked, setLocked] = useState(false);
  const attempt = useRef<{ key: string; body: Body } | undefined>(undefined),
    busy = useRef(false);
  const variants = useQuery({
    queryKey: ['inventory-variant-options', q, page],
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/product-variants', {
          params: { query: { q, page, pageSize: 20, sortBy: 'sku', sortOrder: 'asc' } },
        }),
      ),
    retry: false,
  });
  function add() {
    setValidation('');
    const variant = variants.data?.data.find((row) => row.id === variantId);
    if (
      !variant ||
      !/^-?(0|[1-9]\d{0,14})(\.\d{1,3})?$/.test(quantity) ||
      /^-?0(\.0+)?$/.test(quantity) ||
      (kind === 'OPENING' && quantity.startsWith('-')) ||
      (quantity.startsWith('-') && cost !== '') ||
      (cost !== '' && !/^(0|[1-9]\d{0,13})(\.\d{1,6})?$/.test(cost)) ||
      lines.some((row) => row.variantId === variantId) ||
      lines.length >= 100
    ) {
      setValidation(
        'Chọn SKU chưa có trong phiếu, số lượng khác 0 (tối đa 3 số lẻ). Tồn đầu kỳ phải dương; dòng giảm tồn không có giá nhập. Giá nhập tối đa 6 số lẻ.',
      );
      return;
    }
    setLines([
      ...lines,
      { variantId, sku: variant.sku, quantityDelta: quantity, unitCost: cost || null },
    ]);
    setVariant('');
    setQuantity('1');
    setCost('');
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    if (!lines.length || !warehouseId || !reason.trim()) {
      setValidation('Chọn kho, nhập lý do và thêm ít nhất một SKU.');
      return;
    }
    busy.current = true;
    setPending(true);
    setError(undefined);
    setValidation('');
    setLocked(true);
    attempt.current ??= {
      key: crypto.randomUUID(),
      body: {
        warehouseId,
        kind,
        reason: reason.trim(),
        items: lines.map(({ variantId, quantityDelta, unitCost }) => ({
          variantId,
          quantityDelta,
          unitCost,
        })),
      },
    };
    try {
      const params = await csrfParams();
      const result = unwrap(
        await api.POST('/api/v1/inventory/adjustments', {
          params: { header: { ...params.header, 'Idempotency-Key': attempt.current.key } },
          body: attempt.current.body,
        }),
      );
      onSave(result.data.id);
    } catch (error) {
      setError(error);
      if (
        error instanceof ApiFailure &&
        error.status < 500 &&
        !['REQUEST_IN_PROGRESS', 'RATE_LIMITED'].includes(error.code)
      ) {
        attempt.current = undefined;
        setLocked(false);
      }
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <form className="form-stack" onSubmit={submit} aria-busy={pending}>
      <h2>Tạo phiếu tồn kho</h2>
      <FormError error={error} />
      {validation ? (
        <p role="alert" className="form-error">
          {validation}
        </p>
      ) : null}
      <fieldset className="catalog-fields" disabled={pending || locked}>
        <WarehousePicker value={warehouseId} onChange={setWarehouse} activeOnly />
        <label>
          Loại phiếu
          <select
            value={kind}
            disabled={lines.length > 0}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <option value="OPENING">Tồn đầu kỳ</option>
            <option value="ADJUSTMENT">Điều chỉnh</option>
          </select>
        </label>
        <label>
          Lý do
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            maxLength={1000}
          />
        </label>
        <div className="edit-panel">
          <h3>Thêm dòng hàng</h3>
          <label>
            Tìm SKU
            <Input
              type="search"
              value={q}
              maxLength={100}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
                setVariant('');
              }}
            />
          </label>
          <label>
            SKU
            <select value={variantId} onChange={(e) => setVariant(e.target.value)}>
              <option value="">Chọn SKU</option>
              {variants.data?.data.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.sku} · {row.name}
                </option>
              ))}
            </select>
          </label>
          <div className="actions">
            <Button
              type="button"
              disabled={page === 1 || variants.isFetching}
              onClick={() => {
                setPage(page - 1);
                setVariant('');
              }}
            >
              SKU trước
            </Button>
            <Button
              type="button"
              disabled={page * 20 >= (variants.data?.meta.total ?? 0) || variants.isFetching}
              onClick={() => {
                setPage(page + 1);
                setVariant('');
              }}
            >
              SKU tiếp
            </Button>
            {variants.isFetching ? <span role="status">Đang tải SKU…</span> : null}
          </div>
          <FormError error={variants.error} />
          {variants.error ? (
            <Button type="button" onClick={() => void variants.refetch()}>
              Thử tải SKU lại
            </Button>
          ) : null}
          <label>
            Số lượng thay đổi
            <Input
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              maxLength={20}
            />
          </label>
          <label>
            Giá nhập mỗi đơn vị (để trống nếu chưa biết)
            <Input
              inputMode="decimal"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              maxLength={21}
            />
          </label>
          <p>Dùng dấu chấm thập phân. Điều chỉnh giảm dùng số âm. Phiếu tối đa 100 SKU.</p>
          <Button type="button" disabled={lines.length >= 100} onClick={add}>
            Thêm vào phiếu
          </Button>
        </div>
        <div className="table-scroll" role="region" aria-label="Các dòng nhập tồn" tabIndex={0}>
          <table>
            <caption>{lines.length}/100 SKU trong phiếu</caption>
            <thead>
              <tr>
                <th scope="col">SKU</th>
                <th scope="col">Số lượng</th>
                <th scope="col">Giá nhập</th>
                <th scope="col">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((row) => (
                <tr key={row.variantId}>
                  <td>{row.sku}</td>
                  <td>{row.quantityDelta}</td>
                  <td>{row.unitCost ?? 'Chưa biết'}</td>
                  <td>
                    <Button
                      type="button"
                      onClick={() =>
                        setLines(lines.filter((line) => line.variantId !== row.variantId))
                      }
                      aria-label={'Bỏ SKU ' + row.sku}
                    >
                      Bỏ
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </fieldset>
      {locked && !pending ? (
        <p role="status">
          Kết quả chưa chắc chắn. Giữ nguyên phiếu và bấm tạo lại để kiểm tra cùng yêu cầu.
        </p>
      ) : null}
      <div className="actions">
        <Button type="submit" disabled={pending || !lines.length}>
          {pending ? 'Đang tạo…' : 'Tạo phiếu'}
        </Button>
        <Button type="button" disabled={pending || locked} onClick={onCancel}>
          Đóng
        </Button>
      </div>
    </form>
  );
}
