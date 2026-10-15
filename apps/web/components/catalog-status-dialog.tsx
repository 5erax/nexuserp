'use client';
import { useState } from 'react';
import { Button } from '@nexus/ui/button';
import { Dialog } from '@nexus/ui/dialog';
import { api, csrfParams, unwrap } from '../lib/auth/api';
import { FormError } from './form-error';
export type CatalogStatusTarget = {
  kind: 'product' | 'variant';
  id: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
};
export function CatalogStatusDialog({
  target,
  onSave,
  onClose,
}: {
  target: CatalogStatusTarget;
  onSave: () => void;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState<unknown>();
  const active = target.status === 'ACTIVE';
  async function confirm() {
    setPending(true);
    setError(undefined);
    try {
      const params = { ...(await csrfParams()), path: { id: target.id } },
        body = { status: active ? ('INACTIVE' as const) : ('ACTIVE' as const) };
      if (target.kind === 'product')
        unwrap(await api.PATCH('/api/v1/products/{id}', { params, body }));
      else unwrap(await api.PATCH('/api/v1/product-variants/{id}', { params, body }));
      onSave();
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog
      title={
        (active ? 'Lưu trữ ' : 'Khôi phục ') + (target.kind === 'product' ? 'sản phẩm' : 'SKU')
      }
      onClose={onClose}
      busy={pending}
    >
      <p>
        {active ? 'Lưu trữ' : 'Khôi phục'} “{target.name}”?
      </p>
      <p>
        {active
          ? 'Dữ liệu và lịch sử được giữ lại. Mục đã lưu trữ sẽ không xuất hiện trong lựa chọn bán hàng.'
          : 'Mục này sẽ được kinh doanh lại khi cả sản phẩm và SKU đều đang hoạt động.'}
      </p>
      <FormError error={error} />
      <Button disabled={pending} onClick={() => void confirm()}>
        {pending ? 'Đang xử lý…' : 'Xác nhận'}
      </Button>
    </Dialog>
  );
}
