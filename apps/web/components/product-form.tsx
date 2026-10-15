'use client';
import { useRef, useState } from 'react';
import type { components } from '@nexus/contracts';
import { Button } from '@nexus/ui/button';
import { Input } from '@nexus/ui/components/input';
import { api, csrfParams, unwrap } from '../lib/auth/api';
import { FormError } from './form-error';
type Product = components['schemas']['ProductData'];
export function ProductForm({
  product,
  onSave,
  onCancel,
}: {
  product?: Product;
  onSave: (product: Product) => void;
  onCancel: () => void;
}) {
  const key = useRef<string | undefined>(undefined);
  const [pending, setPending] = useState(false),
    [error, setError] = useState<unknown>();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    const body = {
      name: String(form.get('name')).trim(),
      category: String(form.get('category')).trim() || null,
      description: String(form.get('description')).trim() || null,
    };
    try {
      const params = await csrfParams();
      const response = product
        ? unwrap(
            await api.PATCH('/api/v1/products/{id}', {
              params: { ...params, path: { id: product.id } },
              body,
            }),
          )
        : unwrap(
            await api.POST('/api/v1/products', {
              params: {
                header: {
                  ...params.header,
                  'Idempotency-Key': (key.current ??= crypto.randomUUID()),
                },
              },
              body,
            }),
          );
      onSave(response.data);
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
          Tên sản phẩm
          <Input name="name" defaultValue={product?.name} required maxLength={200} />
        </label>
        <label>
          Danh mục
          <Input name="category" defaultValue={product?.category ?? ''} maxLength={100} />
        </label>
        <label>
          Mô tả
          <textarea
            name="description"
            defaultValue={product?.description ?? ''}
            maxLength={2000}
            rows={4}
          />
        </label>
        <div className="actions">
          <Button type="submit">{pending ? 'Đang lưu…' : 'Lưu sản phẩm'}</Button>
          <Button type="button" onClick={onCancel}>
            Hủy
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
