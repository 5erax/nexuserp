import Link from 'next/link';
export default function NotFound() {
  return (
    <div className="page-heading">
      <span className="small-label">404</span>
      <h1>Không tìm thấy trang</h1>
      <p>Trang này chưa tồn tại trong không gian làm việc.</p>
      <Link href="/">Về tổng quan</Link>
    </div>
  );
}
