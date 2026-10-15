'use client';
import { EmptyState, ErrorState, LoadingState } from '@nexus/ui/states';
import { useState } from 'react';
export default function Showcase() {
  const [retried, setRetried] = useState(false);
  return (
    <>
      <div className="page-heading">
        <span className="small-label">THƯ VIỆN GIAO DIỆN</span>
        <h1>Các trạng thái dùng chung</h1>
        <p>Trang mẫu cho loading, dữ liệu rỗng và lỗi có thể thử lại.</p>
      </div>
      <div className="showcase-list">
        <LoadingState label="Đang tải dữ liệu" />
        <EmptyState
          title="Chưa có đơn hàng"
          description="Đơn mới sẽ xuất hiện tại đây sau khi nghiệp vụ bán hàng được triển khai."
        />
        {retried ? (
          <p role="status">Đã thử lại trạng thái mẫu.</p>
        ) : (
          <ErrorState requestId="sample-request" onRetry={() => setRetried(true)} />
        )}
      </div>
    </>
  );
}
