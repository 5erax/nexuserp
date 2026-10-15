import type { Metadata } from 'next';
import Link from 'next/link';
import { Providers } from './providers';
import { WorkspaceNavigation } from '../components/workspace-navigation';
import messages from '../messages/vi.json';
import './globals.css';
export const metadata: Metadata = {
  title: 'NexusERP · Không gian làm việc',
  description: 'Nền tảng vận hành nhiều chi nhánh',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <a className="skip-link" href="#main">
          Đến nội dung chính
        </a>
        <Providers>
          <div className="workspace">
            <aside className="sidebar">
              <Link className="brand" href="/">
                <span className="brand-mark" aria-hidden="true">
                  N
                </span>
                {messages.brand}
              </Link>
              <span className="nav-caption">{messages.workspace}</span>
              <nav aria-label="Điều hướng chính">
                <Link href="/">{messages.overview}</Link>
                <Link href="/showcase">{messages.components}</Link>
                <WorkspaceNavigation />
              </nav>
              <div className="phase-note">
                <span className="small-label">LỘ TRÌNH</span>
                <p>Phase 0 — Nền tảng</p>
                <span>IAM và phân quyền là bước kế tiếp.</span>
              </div>
            </aside>
            <div className="main-column">
              <header className="topbar">
                <span>{messages.workspace}</span>
                <span className="environment">Phát triển</span>
              </header>
              <main id="main" tabIndex={-1}>
                {children}
              </main>
              <footer>{messages.footer}</footer>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
