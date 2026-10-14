export function ProfileAvatar({ name, size = 'regular' }: { name: string; size?: 'regular' | 'small' }) {
  return <span className={`profile-avatar${size === 'small' ? ' profile-avatar--small' : ''}`} aria-hidden="true">{profileInitials(name)}</span>;
}

export function profileInitials(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  if (words.length > 1) return `${Array.from(words[0])[0] ?? ''}${Array.from(words.at(-1) ?? '')[0] ?? ''}`.toLocaleUpperCase('vi');
  return Array.from(words[0] ?? '').slice(0, 2).join('').toLocaleUpperCase('vi');
}
