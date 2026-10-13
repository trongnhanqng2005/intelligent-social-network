import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <main>
      <h1>Không tìm thấy trang</h1>
      <p>Trang bạn đang tìm không tồn tại.</p>
      <Link to="/">Quay về trang chủ</Link>
    </main>
  );
}
