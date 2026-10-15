import { Suspense } from 'react';
import { SessionGate } from '../../components/session-gate';
export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <SessionGate>{children}</SessionGate>
    </Suspense>
  );
}
