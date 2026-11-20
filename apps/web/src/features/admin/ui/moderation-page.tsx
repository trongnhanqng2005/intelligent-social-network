import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../../../shared/ui/button';
import { ADMIN_PAGE_SIZE, getMembers, getModeratedItems, updateAdminState, type Member, type ModeratedItem } from '../api/admin-api';
import './admin.css';

type Props = { kind: 'members' | 'posts' | 'comments' };
export function ModerationPage({ kind }: Props) {
  const [members, setMembers] = useState<Member[]>([]);
  const [records, setRecords] = useState<ModeratedItem[]>([]);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const title = kind === 'members' ? 'Thành viên' : kind === 'posts' ? 'Bài viết' : 'Bình luận';
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setLoading(true);
    setError('');
    async function load() {
      try {
        if (kind === 'members') {
          const items = await getMembers(query, filter, page, signal);
          if (signal.aborted) return;
          setMembers(items.slice(0, ADMIN_PAGE_SIZE));
          setHasNext(items.length > ADMIN_PAGE_SIZE);
        } else {
          const items = await getModeratedItems(kind, query, filter, page, signal);
          if (signal.aborted) return;
          setRecords(items.slice(0, ADMIN_PAGE_SIZE));
          setHasNext(items.length > ADMIN_PAGE_SIZE);
        }
      } catch {
        if (!signal.aborted) setError(`Không thể tải ${title.toLocaleLowerCase('vi')}.`);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [kind, query, filter, title, page, attempt]);
  async function toggle(id: string, current: boolean) {
    setBusy(id); setMessage('');
    try {
      await updateAdminState(`/admin/${kind}/${encodeURIComponent(id)}/${kind === 'members' ? 'lock' : 'visibility'}`,
        kind === 'members' ? { locked: !current } : { hidden: !current });
      setMessage('Đã cập nhật. Thay đổi này có thể được đảo ngược.');
      setAttempt((value) => value + 1);
    } catch { setMessage('Không thể cập nhật. Vui lòng thử lại.'); }
    finally { setBusy(''); }
  }
  return <section className="admin-dashboard" aria-labelledby="moderation-title">
    <span className="profile-eyebrow">WEYLUME · QUẢN TRỊ</span><h1 id="moderation-title">Kiểm duyệt {title.toLocaleLowerCase('vi')}</h1>
    <p>Quản lý nội dung và tài khoản thật. Mọi thao tác có thể được đảo ngược.</p>
    <div className="admin-controls">
      <label>Tìm {title.toLocaleLowerCase('vi')} <input value={query} maxLength={200} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder={kind === 'members' ? 'Email hoặc tên hiển thị' : 'Nội dung hoặc tác giả'} /></label>
      <label>Trạng thái <select value={filter} onChange={(e) => { setFilter(e.target.value); setPage(0); }}>
        <option value="all">Tất cả</option>{kind === 'members' ? <><option value="active">Đang hoạt động</option><option value="locked">Đã khóa</option></> : <><option value="visible">Đang hiển thị</option><option value="hidden">Đã ẩn</option></>}
      </select></label>
    </div>
    {message && <p role="status" aria-live="polite">{message}</p>}
    {loading && <p role="status">Đang tải {title.toLocaleLowerCase('vi')}…</p>}
    {error && <div role="alert" className="admin-error">{error} <Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>Thử lại</Button></div>}
    {!loading && !error && (kind === 'members' ? members.length === 0 : records.length === 0) && <p className="admin-empty">Không có kết quả phù hợp.</p>}
    {!loading && !error && kind === 'members' && members.length > 0 && <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Thành viên</th><th>Vai trò</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>
      {members.map((m) => <tr key={m.id}><td><strong>{m.displayName}</strong><br />{m.email}</td><td>{m.role}</td><td>{m.locked ? 'Đã khóa' : 'Hoạt động'}</td><td><Button variant="secondary" disabled={m.role === 'ADMIN' || Boolean(busy)} pending={busy === m.id} pendingLabel="Đang lưu…" onClick={() => void toggle(m.id, m.locked)}>{m.locked ? 'Mở khóa' : 'Khóa tài khoản'}</Button></td></tr>)}
    </tbody></table></div>}
    {!loading && !error && kind !== 'members' && records.length > 0 && <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Nội dung</th><th>Tác giả</th><th>Ngày</th>{kind === 'comments' && <th>Bài viết</th>}<th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>
      {records.map((r) => <tr key={r.id}><td>{r.content}</td><td><Link to={`/thanh-vien/${encodeURIComponent(r.authorId)}`}>{r.authorName}</Link></td><td>{new Date(r.createdAt).toLocaleString('vi-VN')}</td>{kind === 'comments' && <td>{r.postId ? <Link to={`/bai-viet/${encodeURIComponent(r.postId)}`}>Mở bài viết</Link> : '—'}</td>}<td>{r.hidden ? 'Đã ẩn' : 'Hiển thị'}</td><td><Button variant="secondary" disabled={Boolean(busy)} pending={busy === r.id} pendingLabel="Đang lưu…" onClick={() => void toggle(r.id, r.hidden)}>{r.hidden ? 'Hiện lại' : 'Ẩn'}</Button></td></tr>)}
    </tbody></table></div>}
    {!loading && !error && (page > 0 || hasNext) && <nav className="admin-controls" aria-label="Trang kết quả">
      <Button variant="secondary" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Trang trước</Button>
      <span>Trang {page + 1}</span>
      <Button variant="secondary" disabled={!hasNext} onClick={() => setPage((value) => value + 1)}>Trang sau</Button>
    </nav>}
  </section>;
}
