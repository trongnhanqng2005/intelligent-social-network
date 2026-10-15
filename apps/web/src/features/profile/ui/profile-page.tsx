import { useEffect, useRef, useState, type FormEvent } from 'react';
import { RefreshCw, UserRound } from 'lucide-react';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { getOwnProfile, updateOwnProfile, UserApiError, type OwnProfile } from '../api/profile-api';
import { ProfileAvatar } from './profile-avatar';
import { ProfilePosts } from '../../posts/ui/profile-posts';

type Draft = { displayName: string; bio: string; location: string };

export function ProfilePage() {
  const [profile, setProfile] = useState<OwnProfile>();
  const [draft, setDraft] = useState<Draft>({ displayName: '', bio: '', location: '' });
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const errorSummary = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(false);
    getOwnProfile(controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      setProfile(value);
      setDraft(toDraft(value));
      setLoading(false);
    }).catch(() => {
      if (controller.signal.aborted) return;
      setLoadError(true);
      setLoading(false);
    });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    if (error) errorSummary.current?.focus();
  }, [error]);

  function beginEdit() {
    if (!profile) return;
    setDraft(toDraft(profile));
    setError('');
    setFieldErrors({});
    setConflict(false);
    setNotice('');
    setEditing(true);
  }

  function cancelEdit() {
    if (profile) setDraft(toDraft(profile));
    setError('');
    setFieldErrors({});
    setConflict(false);
    setNotice('');
    setEditing(false);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    setError('');
    setFieldErrors({});
    setNotice('');
    const localErrors = validateDraft(draft);
    if (Object.keys(localErrors).length) {
      setFieldErrors(localErrors);
      setError('Vui lòng kiểm tra lại thông tin hồ sơ.');
      return;
    }
    setPending(true);
    try {
      const updated = await updateOwnProfile({
        displayName: draft.displayName,
        bio: draft.bio,
        location: draft.location,
        expectedVersion: profile.version,
      });
      setProfile(updated);
      setDraft(toDraft(updated));
      setEditing(false);
      setConflict(false);
      setNotice('Hồ sơ đã được lưu.');
    } catch (cause) {
      if (cause instanceof UserApiError && cause.code === 'PROFILE_CONFLICT') {
        setConflict(true);
        setError('Hồ sơ đã được thay đổi ở nơi khác. Bản nháp của bạn vẫn được giữ lại.');
      } else if (cause instanceof UserApiError && cause.fieldErrors) {
        setFieldErrors(cause.fieldErrors);
        setError(cause.message);
      } else {
        setError(cause instanceof Error ? cause.message : 'Không thể lưu hồ sơ. Vui lòng thử lại.');
      }
    } finally {
      setPending(false);
    }
  }

  async function reloadLatestVersion() {
    if (!profile) return;
    setPending(true);
    setError('');
    try {
      const latest = await getOwnProfile();
      setProfile(latest);
      setConflict(false);
      setNotice('Đã tải phiên bản mới. Bản nháp vẫn được giữ lại; hãy kiểm tra trước khi lưu.');
    } catch {
      setError('Không thể tải phiên bản mới. Bản nháp của bạn vẫn được giữ lại.');
    } finally {
      setPending(false);
    }
  }

  if (loading) return <section className="profile-loading" aria-labelledby="profile-title"><h1 id="profile-title">Hồ sơ của tôi</h1><p role="status">Đang tải hồ sơ…</p></section>;
  if (loadError || !profile) {
    return (
      <section className="profile-error-state" aria-labelledby="profile-title">
        <h1 id="profile-title">Chưa thể tải hồ sơ</h1>
        <Alert tone="error">Dịch vụ đang tạm thời không khả dụng. Vui lòng thử lại.</Alert>
        <Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
          <RefreshCw size={16} aria-hidden="true" /> Thử tải lại
        </Button>
      </section>
    );
  }

  return (
    <section className="profile-page" aria-labelledby="profile-title">
      <header className="profile-heading">
        <span className="profile-eyebrow">KHÔNG GIAN CỦA BẠN</span>
        <h1 id="profile-title">Hồ sơ của tôi</h1>
        <p>Chia sẻ đôi chút để các thành viên khác biết thêm về bạn.</p>
      </header>
      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <div ref={errorSummary} className="profile-error-summary" role="alert" tabIndex={-1}>
        <h2>Cần bạn kiểm tra</h2><p>{error}</p>
        {Object.entries(fieldErrors).length > 0 && <ul>{Object.entries(fieldErrors).map(([field, messages]) =>
          messages.map((message, index) => <li key={`${field}-${index}`}>{fieldLabel(field)}: {message}</li>))}</ul>}
      </div>}
      {conflict && <Alert tone="info">Tải phiên bản mới để cập nhật mã phiên bản. Bạn có thể tiếp tục chỉnh sửa bản nháp sau khi tải.</Alert>}
      <article className="profile-card">
        <div className="profile-identity">
          <ProfileAvatar name={profile.displayName} />
          <div><h2>{profile.displayName}</h2><p><UserRound size={14} aria-hidden="true" /> Thành viên Weylume</p></div>
        </div>
        <p className="profile-visibility">Thông tin tên hiển thị, giới thiệu và địa điểm sẽ được hiển thị với các thành viên đã đăng nhập.</p>
        {editing ? (
          <form onSubmit={save} noValidate>
            <div className="profile-fields">
              <ProfileField label="Tên hiển thị" name="displayName" value={draft.displayName}
                onChange={(value) => setDraft((current) => ({ ...current, displayName: value }))}
                maxLength={80} hint="Từ 2 đến 80 ký tự Unicode." error={fieldErrors.displayName?.[0]} />
              <ProfileField label="Giới thiệu" name="bio" value={draft.bio}
                onChange={(value) => setDraft((current) => ({ ...current, bio: value }))}
                maxLength={280} hint="Không bắt buộc. Có thể viết nhiều dòng." error={fieldErrors.bio?.[0]} multiline />
              <ProfileField label="Địa điểm" name="location" value={draft.location}
                onChange={(value) => setDraft((current) => ({ ...current, location: value }))}
                maxLength={80} hint="Không bắt buộc; vui lòng không nhập địa chỉ chi tiết." error={fieldErrors.location?.[0]} />
            </div>
            <div className="profile-actions">
              <Button type="submit" pending={pending} pendingLabel="Đang lưu…">Lưu hồ sơ</Button>
              <Button type="button" variant="secondary" disabled={pending} onClick={cancelEdit}>Hủy</Button>
              {conflict && <Button type="button" variant="ghost" pending={pending} pendingLabel="Đang tải…" onClick={reloadLatestVersion}>Tải phiên bản mới</Button>}
            </div>
          </form>
        ) : (
          <>
            <dl className="profile-readonly">
              <div><dt>Giới thiệu</dt><dd>{profile.bio || 'Chưa có giới thiệu.'}</dd></div>
              <div><dt>Địa điểm</dt><dd>{profile.location || 'Chưa thêm địa điểm.'}</dd></div>
            </dl>
            <Button onClick={beginEdit}>Chỉnh sửa hồ sơ</Button>
          </>
        )}
      </article>
      <ProfilePosts memberId={profile.id} />
    </section>
  );
}

function ProfileField({
  label, name, value, onChange, maxLength, hint, error, multiline = false,
}: {
  label: string; name: keyof Draft; value: string; onChange(value: string): void;
  maxLength: number; hint: string; error?: string; multiline?: boolean;
}) {
  const hintId = `${name}-hint`;
  const errorId = `${name}-error`;
  const describedBy = error ? `${hintId} ${errorId}` : hintId;
  return (
    <div className="profile-field">
      <label htmlFor={`profile-${name}`}>{label}</label>
      {multiline ? <textarea id={`profile-${name}`} value={value} maxLength={maxLength * 2}
        aria-invalid={Boolean(error)} aria-describedby={describedBy} onChange={(event) => onChange(event.currentTarget.value)} />
        : <input id={`profile-${name}`} value={value} maxLength={maxLength * 2} aria-invalid={Boolean(error)}
          aria-describedby={describedBy} onChange={(event) => onChange(event.currentTarget.value)} />}
      <span id={hintId} className="profile-field-hint">{hint}</span>
      <span className="profile-counter">{Array.from(value).length}/{maxLength}</span>
      {error && <span id={errorId} className="profile-field-error">{error}</span>}
    </div>
  );
}

function toDraft(profile: OwnProfile): Draft {
  return { displayName: profile.displayName, bio: profile.bio ?? '', location: profile.location ?? '' };
}

function validateDraft(draft: Draft): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  const displayNameLength = Array.from(draft.displayName.normalize('NFC').trim()).length;
  if (displayNameLength < 2 || displayNameLength > 80) errors.displayName = ['Tên hiển thị phải có từ 2 đến 80 ký tự.'];
  if (Array.from(draft.bio.normalize('NFC').trim()).length > 280) errors.bio = ['Giới thiệu không được vượt quá 280 ký tự.'];
  if (Array.from(draft.location.normalize('NFC').trim()).length > 80) errors.location = ['Địa điểm không được vượt quá 80 ký tự.'];
  return errors;
}

function fieldLabel(field: string): string {
  return ({ displayName: 'Tên hiển thị', bio: 'Giới thiệu', location: 'Địa điểm', expectedVersion: 'Phiên bản' } as Record<string, string>)[field] ?? 'Thông tin';
}
