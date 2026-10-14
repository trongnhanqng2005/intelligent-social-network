import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Search, X } from 'lucide-react';
import { useLocation, useSearchParams } from 'react-router';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { listMembers, type MemberDirectoryPage } from '../../profile/api/profile-api';
import { MemberCard } from '../../profile/ui/member-card';

export function DiscoveryPage() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const cursor = searchParams.get('cursor') ?? undefined;
  const [searchText, setSearchText] = useState(query);
  const previousCursors = readPreviousCursors(location.state);
  const [page, setPage] = useState<MemberDirectoryPage>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => setSearchText(query), [query]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    listMembers({ q: query, ...(cursor ? { cursor } : {}) }, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setPage(result);
      setLoading(false);
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : 'Chưa thể tải danh sách thành viên.');
      setLoading(false);
    });
    return () => controller.abort();
  }, [query, cursor, reloadKey]);

  const submitSearch = useCallback((event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const next = new URLSearchParams();
    const trimmed = searchText.trim();
    if (trimmed) next.set('q', trimmed);
    setSearchParams(next, { state: { previousCursors: [] } });
  }, [searchText, setSearchParams]);

  function clearSearch() {
    setSearchText('');
    setSearchParams(new URLSearchParams(), { state: { previousCursors: [] } });
  }

  function nextPage() {
    if (!page?.pagination.nextCursor) return;
    const next = new URLSearchParams();
    if (query) next.set('q', query);
    next.set('cursor', page.pagination.nextCursor);
    setSearchParams(next, { state: { previousCursors: [...previousCursors, cursor ?? ''] } });
  }

  function previousPage() {
    if (previousCursors.length === 0) return;
    const previousCursor = previousCursors.at(-1) ?? '';
    const previous = new URLSearchParams();
    if (query) previous.set('q', query);
    if (previousCursor) previous.set('cursor', previousCursor);
    setSearchParams(previous, { state: { previousCursors: previousCursors.slice(0, -1) } });
  }

  return (
    <section className="profile-page" aria-labelledby="discovery-title">
      <header className="profile-heading">
        <span className="profile-eyebrow">CỘNG ĐỒNG WEYLUME</span>
        <h1 id="discovery-title">Khám phá thành viên</h1>
        <p>Tìm hiểu những người đang cùng xây dựng cộng đồng này.</p>
      </header>
      <form className="directory-search" role="search" onSubmit={submitSearch}>
        <div className="profile-field">
          <label htmlFor="member-search">Tìm theo tên hiển thị</label>
          <input id="member-search" type="search" value={searchText} maxLength={160}
            placeholder="Ví dụ: Nguyễn An" onChange={(event) => setSearchText(event.currentTarget.value)} />
          <span className="profile-field-hint">Tìm kiếm không phân biệt dấu tiếng Việt.</span>
        </div>
        <Button type="submit"><Search size={17} aria-hidden="true" /> Tìm kiếm</Button>
        {searchText && <Button type="button" variant="secondary" onClick={clearSearch} aria-label="Xóa từ khóa tìm kiếm"><X size={17} aria-hidden="true" /> Xóa</Button>}
      </form>
      {error && <Alert tone="error">{error} <Button variant="ghost" onClick={() => setReloadKey((value) => value + 1)}>Thử lại</Button></Alert>}
      {loading ? <p role="status">Đang tải thành viên…</p> : null}
      {!loading && !error && page?.items.length === 0 && (
        <div className="directory-empty">
          <h2>{query ? 'Chưa tìm thấy thành viên phù hợp.' : 'Chưa có thành viên để hiển thị.'}</h2>
          <p>{query ? 'Thử tên ngắn hơn hoặc kiểm tra lại dấu tiếng Việt.' : 'Hãy quay lại khám phá sau nhé.'}</p>
          {query && <Button variant="secondary" onClick={clearSearch}>Xem tất cả thành viên</Button>}
        </div>
      )}
      {!loading && !error && page && page.items.length > 0 && <>
        <div className="directory-results" aria-label="Kết quả thành viên">
          {page.items.map((member) => <MemberCard key={member.id} profile={member} />)}
        </div>
        <nav className="directory-pagination" aria-label="Phân trang thành viên">
          <Button type="button" variant="secondary" disabled={previousCursors.length === 0} onClick={previousPage}>
            <ArrowLeft size={17} aria-hidden="true" /> Trang trước
          </Button>
          <span className="visually-hidden" role="status">{page.pagination.hasMore ? 'Còn thành viên ở trang tiếp theo.' : 'Đã đến cuối danh sách.'}</span>
          <Button type="button" variant="secondary" disabled={!page.pagination.hasMore} onClick={nextPage}>
            Trang tiếp <ArrowRight size={17} aria-hidden="true" />
          </Button>
        </nav>
      </>}
    </section>
  );
}

function readPreviousCursors(state: unknown): string[] {
  if (typeof state !== 'object' || state === null || !('previousCursors' in state)) return [];
  const cursors = state.previousCursors;
  return Array.isArray(cursors) && cursors.every((value) => typeof value === 'string') ? cursors : [];
}
