import { Suspense } from 'react';
import { LoginForm } from './login-form';
import messages from '../../messages/vi.json';
export default function LoginPage() {
  return (
    <div className="auth-panel">
      <span className="small-label">NEXUSERP</span>
      <h1>{messages.auth.login}</h1>
      <p>{messages.auth.loginIntro}</p>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
