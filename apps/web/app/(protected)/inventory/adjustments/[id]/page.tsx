'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@nexus/ui/button';
import { LoadingState } from '@nexus/ui/states';
import { SessionGate } from '../../../../../components/session-gate';
import { FormError } from '../../../../../components/form-error';
import { api, ApiFailure, csrfParams, unwrap } from '../../../../../lib/auth/api';
import { useSession } from '../../../../../lib/auth/session';
import { adjustmentStatuses } from '../../../../../lib/inventory';

export default function AdjustmentPage() {
  return (
    <SessionGate permission="inventory.movements.read">
      <Adjustment />
    </SessionGate>
  );
}
function Adjustment() {
  const { id } = useParams<{ id: string }>(),
    client = useQueryClient(),
    { data: actor } = useSession();
  const query = useQuery({
    queryKey: ['inventory-adjustment', id],
    queryFn: async () =>
      unwrap(await api.GET('/api/v1/inventory/adjustments/{id}', { params: { path: { id } } })),
    retry: false,
  });
  type Action = 'post' | 'approve' | 'reject' | 'cancel';
  const [pending, setPending] = useState(false),
    [error, setError] = useState<unknown>(),
    [reason, setReason] = useState('');
  const [lockedAction, setLockedAction] = useState<Action | undefined>();
  const attempt = useRef<{ action: Action; key: string; reason: string } | undefined>(undefined),
    busy = useRef(false);
  async function command(action: Action) {
    if (busy.current || (attempt.current && attempt.current.action !== action)) return;
    busy.current = true;
    setPending(true);
    setError(undefined);
    setLockedAction(action);
    attempt.current ??= { action, key: crypto.randomUUID(), reason: reason.trim() };
    try {
      const csrf = await csrfParams();
      const params = {
        path: { id },
        header: { ...csrf.header, 'Idempotency-Key': attempt.current.key },
      };
      const result =
        action === 'reject'
          ? unwrap(
              await api.POST('/api/v1/inventory/adjustments/{id}/reject', {
                params,
                body: { reason: attempt.current.reason },
              }),
            )
          : action === 'approve'
            ? unwrap(await api.POST('/api/v1/inventory/adjustments/{id}/approve', { params }))
            : action === 'cancel'
              ? unwrap(await api.POST('/api/v1/inventory/adjustments/{id}/cancel', { params }))
              : unwrap(await api.POST('/api/v1/inventory/adjustments/{id}/post', { params }));
      client.setQueryData(['inventory-adjustment', id], result);
      await client.invalidateQueries({ queryKey: ['inventory-adjustment', id] });
      attempt.current = undefined;
      setLockedAction(undefined);
      setReason('');
      void client.invalidateQueries({ queryKey: ['inventory'] });
    } catch (error) {
      setError(error);
      if (
        error instanceof ApiFailure &&
        error.status < 500 &&
        !['REQUEST_IN_PROGRESS', 'RATE_LIMITED'].includes(error.code)
      ) {
        attempt.current = undefined;
        setLockedAction(undefined);
        void query.refetch();
      }
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  if (query.isPending) return <LoadingState />;
  if (query.error || !query.data)
    return (
      <>
        <FormError error={query.error} />
        <Button onClick={() => void query.refetch()}>Thử lại</Button>
      </>
    );
  const doc = query.data.data,
    has = (permission: string) =>
      actor?.grants[permission]?.some(
        (scope) =>
          scope === 'ORG' || (scope === 'BRANCH' && actor.branchIds.includes(doc.branchId)),
      );
  const disabled = () => pending || !!lockedAction;
  return (
    <div className="catalog-content inventory-content">
      <Link href="/inventory?view=adjustments">Quay lại danh sách phiếu</Link>
      <div className="page-heading">
        <h1>{doc.kind === 'OPENING' ? 'Phiếu tồn đầu kỳ' : 'Phiếu điều chỉnh'}</h1>
        <p role="status">{adjustmentStatuses[doc.status] ?? doc.status}</p>
      </div>
      <dl className="profile-details">
        <dt>Kho</dt>
        <dd>{doc.warehouseName}</dd>
        <dt>Lý do</dt>
        <dd>{doc.reason}</dd>
        <dt>Tổng lượng thay đổi tuyệt đối</dt>
        <dd>{doc.totalAbsoluteQuantity}</dd>
        <dt>Ngưỡng phê duyệt của phiếu</dt>
        <dd>{doc.approvalThreshold}</dd>
        <dt>Tạo lúc</dt>
        <dd>{new Date(doc.createdAt).toLocaleString('vi-VN')}</dd>
        {doc.approvedAt ? (
          <>
            <dt>Duyệt lúc</dt>
            <dd>{new Date(doc.approvedAt).toLocaleString('vi-VN')}</dd>
          </>
        ) : null}
        {doc.decisionReason ? (
          <>
            <dt>Lý do từ chối</dt>
            <dd>{doc.decisionReason}</dd>
          </>
        ) : null}
      </dl>
      <p>
        {doc.requiresApproval
          ? 'Phiếu cần một người khác có quyền phê duyệt trước khi ghi sổ.'
          : 'Phiếu trong ngưỡng cho phép ghi sổ trực tiếp.'}
      </p>
      <FormError error={error} />
      {lockedAction && !pending ? (
        <>
          <p role="status">
            Kết quả thao tác chưa chắc chắn. Nội dung được giữ nguyên để kiểm tra lại.
          </p>
          <Button onClick={() => void command(lockedAction)}>Thử lại thao tác</Button>
        </>
      ) : null}
      <div className="actions" aria-busy={pending}>
        {has('inventory.adjustments.post') && ['DRAFT', 'APPROVED'].includes(doc.status) ? (
          <Button disabled={disabled()} onClick={() => void command('post')}>
            {doc.status === 'DRAFT' && doc.requiresApproval ? 'Gửi phê duyệt' : 'Ghi sổ'}
          </Button>
        ) : null}
        {has('inventory.adjustments.approve') &&
        doc.status === 'PENDING_APPROVAL' &&
        doc.createdBy !== actor?.id ? (
          <Button disabled={disabled()} onClick={() => void command('approve')}>
            Phê duyệt
          </Button>
        ) : null}
        {has('inventory.adjustments.create') &&
        ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(doc.status) ? (
          <Button disabled={disabled()} onClick={() => void command('cancel')}>
            Hủy phiếu
          </Button>
        ) : null}
        <Button disabled={pending} onClick={() => void query.refetch()}>
          Cập nhật trạng thái
        </Button>
      </div>
      {has('inventory.adjustments.approve') && doc.status === 'PENDING_APPROVAL' ? (
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void command('reject');
          }}
        >
          <label>
            Lý do từ chối
            <textarea
              required
              maxLength={1000}
              disabled={pending || !!lockedAction}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={disabled() || !reason.trim()}>
            Từ chối phiếu
          </Button>
        </form>
      ) : null}
      <div className="table-scroll" role="region" aria-label="Dòng hàng của phiếu" tabIndex={0}>
        <table>
          <caption>{doc.itemCount} SKU</caption>
          <thead>
            <tr>
              <th scope="col">SKU</th>
              <th scope="col">Biến thể</th>
              <th scope="col">Thay đổi</th>
              <th scope="col">Giá nhập</th>
            </tr>
          </thead>
          <tbody>
            {doc.items.map((row) => (
              <tr key={row.id}>
                <td>{row.sku}</td>
                <td>{row.variantName}</td>
                <td>{row.quantityDelta}</td>
                <td>{row.unitCost ?? 'Chưa biết'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {doc.status === 'POSTED' ? (
        <Link href={'/inventory?view=movements&referenceId=' + doc.id}>
          Xem biến động từ phiếu này
        </Link>
      ) : null}
    </div>
  );
}
