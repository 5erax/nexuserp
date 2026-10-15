'use client';
import { useId, useRef, useState } from 'react';
import type { components } from '@nexus/contracts';
import { Button } from '@nexus/ui/button';
import { Input } from '@nexus/ui/components/input';
import { api, csrfParams, unwrap } from '../lib/auth/api';
import { FormError } from './form-error';
type Variant = components['schemas']['VariantData'];
export function VariantForm({
  productId,
  variant,
  onSave,
  onCancel,
}: {
  productId: string;
  variant?: Variant;
  onSave: () => void;
  onCancel: () => void;
}) {
  const key = useRef<string | undefined>(undefined),
    help = useId();
  const [pending, setPending] = useState(false),
    [error, setError] = useState<unknown>();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    const body = {
      sku: String(form.get('sku')).trim().toUpperCase(),
      name: String(form.get('name')).trim(),
      sellingPrice: String(form.get('sellingPrice')).trim(),
      lowStockThreshold: String(form.get('lowStockThreshold')).trim(),
    };
    try {
      const params = await csrfParams();
      if (variant)
        unwrap(
          await api.PATCH('/api/v1/product-variants/{id}', {
            params: { ...params, path: { id: variant.id } },
            body,
          }),
        );
      else
        unwrap(
          await api.POST('/api/v1/products/{id}/variants', {
            params: {
              path: { id: productId },
              header: {
                ...params.header,
                'Idempotency-Key': (key.current ??= crypto.randomUUID()),
              },
            },
            body,
          }),
        );
      onSave();
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="form-stack" onSubmit={submit} aria-busy={pending}>
      <FormError error={error} />
      <fieldset disabled={pending} className="catalog-fields">
        <label>
          SKU
          <Input
            name="sku"
            defaultValue={variant?.sku}
            required
            maxLength={64}
            aria-describedby={help}
          />
        </label>
        <p id={help}>SKU có lịch sử kho không thể đổi. Tên và giá bán vẫn có thể cập nhật.</p>
        <label>
          Tên biến thể
          <Input name="name" defaultValue={variant?.name} required maxLength={200} />
        </label>
        <label>
          Giá bán (VND)
          <Input
            name="sellingPrice"
            defaultValue={variant?.sellingPrice ?? '0'}
            inputMode="numeric"
            pattern="(0|[1-9][0-9]{0,19})"
            maxLength={20}
            title="Số nguyên không âm, tối đa 20 chữ số"
            required
          />
        </label>
        <label>
          Ngưỡng cảnh báo tồn
          <Input
            name="lowStockThreshold"
            defaultValue={variant?.lowStockThreshold ?? '0'}
            inputMode="decimal"
            pattern="(0|[1-9][0-9]{0,14})([.][0-9]{1,3})?"
            maxLength={19}
            title="Số không âm, tối đa 3 chữ số thập phân; dùng dấu chấm"
            required
          />
        </label>
        <div className="actions">
          <Button type="submit">{pending ? 'Đang lưu…' : 'Lưu SKU'}</Button>
          <Button type="button" onClick={onCancel}>
            Hủy
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
