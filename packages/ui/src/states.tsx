'use client';
import { Button } from './button';
export function LoadingState({ label = 'Đang tải…' }: { label?: string }) {
  return (
    <div role="status" aria-busy="true" className="state-panel">
      <span className="skeleton-line" />
      {label}
    </div>
  );
}
export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="state-panel">
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}
export function ErrorState({ requestId, onRetry }: { requestId?: string; onRetry: () => void }) {
  return (
    <div role="alert" className="state-panel error-panel">
      <h2>Chưa thể tải dữ liệu</h2>
      <p>Kiểm tra kết nối và thử lại.</p>
      {requestId ? <p className="support-id">Mã hỗ trợ: {requestId}</p> : null}
      <Button onClick={onRetry}>Thử lại</Button>
    </div>
  );
}
