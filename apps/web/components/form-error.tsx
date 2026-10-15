import { ApiFailure } from '../lib/auth/api';
import messages from '../messages/vi.json';
export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="form-error" role="alert">
      <p>{error instanceof ApiFailure ? error.message : messages.auth.network}</p>
      {error instanceof ApiFailure && error.retryAfter ? (
        <p>
          {messages.auth.retryAfter} {error.retryAfter} {messages.auth.seconds}.
        </p>
      ) : null}
      {error instanceof ApiFailure && error.requestId ? (
        <p>
          {messages.auth.support} {error.requestId}
        </p>
      ) : null}
    </div>
  );
}
