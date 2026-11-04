import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Send } from 'lucide-react';
import { useAuth } from '../../auth/model/auth-context';
import { Button } from '../../../shared/ui/button';
import { countPostContentCodePoints } from '../model/post-content';
import { createPost, type PostVisibility } from '../api/posts-api';

export function PostComposer({ onCreated, onRefreshFeed }: {
  onCreated(): void;
  onRefreshFeed(): Promise<boolean>;
}) {
  const { retry: retrySession } = useAuth();
  const [content, setContent] = useState('');
  const [visibility, setVisibility] = useState<PostVisibility>('friends');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  const [reconciliationRequested, setReconciliationRequested] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [notice, setNotice] = useState('');
  const errorRef = useRef<HTMLDivElement>(null);
  const count = countPostContentCodePoints(content);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitPost();
  }

  async function submitPost() {
    if (pending || unknownOutcome) return;
    setError('');
    setFieldError('');
    setUnknownOutcome(false);
    setReconciliationRequested(false);
    setNotice('');
    if (count === 0) {
      setFieldError('Vui lòng nhập nội dung bài viết.');
      setError('Bài viết cần có nội dung.');
      return;
    }
    if (count > 2000) {
      setFieldError('Nội dung bài viết không được vượt quá 2.000 ký tự.');
      setError('Vui lòng rút ngắn bài viết trước khi đăng.');
      return;
    }
    setPending(true);
    try {
      await createPost({ content, visibility });
      setContent('');
      setNotice('Bài viết đã được đăng.');
      onCreated();
    } catch (cause) {
      const details = readErrorDetails(cause);
      if (details.status === 401) retrySession();
      setUnknownOutcome(details.code === 'WRITE_OUTCOME_UNKNOWN');
      setReconciliationRequested(false);
      setFieldError(details.fieldErrors?.content?.[0] ?? '');
      setError(cause instanceof Error ? cause.message : 'Không thể đăng bài viết. Vui lòng thử lại.');
    } finally {
      setPending(false);
    }
  }

  async function reconcileUnknownOutcome() {
    if (reconciling) return;
    setReconciling(true);
    setNotice('Đang tải lại bảng tin để kiểm tra kết quả đăng bài.');
    try {
      const refreshed = await onRefreshFeed();
      if (refreshed) {
        setReconciliationRequested(true);
        setNotice('Đã tải lại bảng tin. Hãy kiểm tra trước khi gửi lại bản nháp.');
      } else {
        setNotice('Chưa tải được bảng tin. Hãy thử kiểm tra lại trước khi gửi lại bản nháp.');
      }
    } catch {
      setNotice('Chưa tải được bảng tin. Hãy thử kiểm tra lại trước khi gửi lại bản nháp.');
    } finally {
      setReconciling(false);
    }
  }

  return (
    <section className="posts-composer" aria-labelledby="post-composer-title">
      <h2 id="post-composer-title">Chia sẻ điều bạn đang nghĩ</h2>
      {notice && <p className="posts-notice" role="status">{notice}</p>}
      {error && <div ref={errorRef} className="posts-error-summary" role="alert" tabIndex={-1}>
        <p>{error}</p>
        {unknownOutcome && <p>Không gửi lại tự động để tránh đăng trùng. Bản nháp vẫn được giữ nguyên.</p>}
        {fieldError && <p>{fieldError}</p>}
        {unknownOutcome && !reconciliationRequested && <Button type="button" variant="secondary"
          pending={reconciling} pendingLabel="Đang tải bảng tin…" onClick={() => void reconcileUnknownOutcome()}>
          Tải lại bảng tin để kiểm tra
        </Button>}
        {unknownOutcome && reconciliationRequested && <Button type="button" variant="secondary" onClick={() => {
          setUnknownOutcome(false);
          setReconciliationRequested(false);
          setError('');
          setNotice('Bạn đã xác nhận kiểm tra bảng tin. Hãy cân nhắc nội dung trước khi gửi lại.');
        }}>
          Tôi đã kiểm tra, cho phép gửi lại
        </Button>}
      </div>}
      <form onSubmit={submit} noValidate>
        <label className="posts-field-label" htmlFor="post-content">Nội dung bài viết</label>
        <textarea
          id="post-content"
          disabled={pending}
          value={content}
          onChange={(event) => {
            setContent(event.currentTarget.value);
            if (!unknownOutcome) {
              setError('');
              setFieldError('');
            }
          }}
          aria-invalid={Boolean(fieldError)}
          aria-describedby="post-content-hint post-content-count post-content-error"
          placeholder="Chia sẻ một khoảnh khắc, suy nghĩ hoặc điều bạn yêu thích…"
          rows={5}
        />
        <div className="posts-composer-meta">
          <span id="post-content-hint">Bài viết chỉ hỗ trợ văn bản thuần. Dùng dòng mới để định dạng.</span>
          <span id="post-content-count" className={count > 2000 ? 'posts-counter posts-counter--over' : 'posts-counter'}>
            {count.toLocaleString('vi-VN')}/2.000 ký tự
          </span>
        </div>
        <span id="post-content-error" className="posts-field-error">{fieldError}</span>
        <div className="posts-composer-actions">
          <div className="posts-visibility-field">
            <label htmlFor="post-visibility">Ai có thể xem?</label>
            <select id="post-visibility" value={visibility} disabled={pending} onChange={(event) => setVisibility(event.currentTarget.value as PostVisibility)}>
              <option value="friends">Chỉ bạn bè</option>
              <option value="members">Thành viên Weylume</option>
            </select>
          </div>
          <Button type="submit" disabled={unknownOutcome} pending={pending} pendingLabel="Đang đăng…">
            <Send size={17} aria-hidden="true" /> Đăng bài
          </Button>
        </div>
      </form>
    </section>
  );
}

function readErrorDetails(value: unknown): {
  status?: number;
  code?: string;
  fieldErrors?: Record<string, string[]>;
} {
  if (typeof value !== 'object' || value === null) return {};
  const details = value as { status?: unknown; code?: unknown; fieldErrors?: unknown };
  const fieldErrors = typeof details.fieldErrors === 'object' && details.fieldErrors !== null
    ? Object.fromEntries(Object.entries(details.fieldErrors).filter((entry): entry is [string, string[]] =>
      Array.isArray(entry[1]) && entry[1].every((message) => typeof message === 'string')))
    : undefined;
  return {
    ...(typeof details.status === 'number' ? { status: details.status } : {}),
    ...(typeof details.code === 'string' ? { code: details.code } : {}),
    ...(fieldErrors ? { fieldErrors } : {}),
  };
}
