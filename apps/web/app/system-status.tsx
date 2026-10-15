'use client';
import { useQuery } from '@tanstack/react-query';
import { createApiClient } from '@nexus/contracts';
import { Button } from '@nexus/ui/button';
import messages from '../messages/vi.json';
class ReadinessError extends Error {
  constructor(public readonly requestId?: string) {
    super(messages.failed);
  }
}
async function checkConnection() {
  const client = createApiClient(window.location.origin);
  const { data, error } = await client.GET('/api/v1/health/ready', {
    signal: AbortSignal.timeout(5000),
  });
  if (error) {
    const requestId = error?.error?.requestId;
    throw new ReadinessError(
      typeof requestId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(requestId)
        ? requestId
        : undefined,
    );
  }
  if (!data) throw new ReadinessError();
  return data;
}
export function SystemStatus() {
  const query = useQuery({ queryKey: ['system-readiness'], queryFn: checkConnection });
  return (
    <section className="connection-panel" aria-labelledby="system-heading">
      <div>
        <span className="small-label">HỆ THỐNG</span>
        <h2 id="system-heading">{messages.systemTitle}</h2>
        <p>{messages.systemIntro}</p>
      </div>
      <div className="connection-result">
        <p role="status">
          <span className={'status-dot ' + (query.isSuccess ? 'online' : '')} aria-hidden="true" />
          {query.isPending ? messages.waiting : query.isError ? messages.failed : messages.ready}
        </p>
        {query.error instanceof ReadinessError && query.error.requestId ? (
          <small>Mã hỗ trợ: {query.error.requestId}</small>
        ) : null}
        <Button disabled={query.isFetching} onClick={() => void query.refetch()}>
          {query.isFetching ? 'Đang kiểm tra…' : messages.retry}
        </Button>
      </div>
    </section>
  );
}
