import Link from 'next/link';
import messages from '../../messages/vi.json';
export default function ForbiddenPage() {
  return (
    <>
      <span className="small-label">403</span>
      <h1>{messages.auth.forbidden}</h1>
      <Link href="/workspace">{messages.auth.workspace}</Link>
    </>
  );
}
