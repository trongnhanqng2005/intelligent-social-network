export const DEMO_PASSWORD = 'Weylume-Local-Test-2026!';
export const DEMO_ADMIN = { email: 'admin123@gmail.com', displayName: 'Weylume Admin', role: 'ADMIN' } as const;

export const DEMO_MEMBERS = [
  ['annguyen482@gmail.com', 'An Nguyễn'],
  ['binhtran731@gmail.com', 'Bình Trần'],
  ['chile259@gmail.com', 'Chi Lê'],
  ['dungpham604@gmail.com', 'Dũng Phạm'],
  ['giangvo815@gmail.com', 'Giang Võ'],
  ['hadang367@gmail.com', 'Hà Đặng'],
  ['huybui923@gmail.com', 'Huy Bùi'],
  ['lando146@gmail.com', 'Lan Đỗ'],
  ['minhho578@gmail.com', 'Minh Hồ'],
  ['ngocphan294@gmail.com', 'Ngọc Phan'],
  ['quanvu860@gmail.com', 'Quân Vũ'],
  ['thaodinh413@gmail.com', 'Thảo Đinh'],
].map(([email, displayName]) => ({ email: email!, displayName: displayName!, role: 'USER' as const }));

export const DEMO_ACCOUNTS = [...DEMO_MEMBERS, DEMO_ADMIN];
export const LEGACY_EMAILS = DEMO_MEMBERS.map((_, index) =>
  `social-demo-${String(index + 1).padStart(2, '0')}@example.test`,
);

export class SocialDemoRefusal extends Error {}

export function isLoopbackHost(host: string | undefined): boolean {
  return host !== undefined && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);
}

export function isLoopbackUrl(url: string | undefined): boolean {
  return !!url && URL.canParse(url) && isLoopbackHost(new URL(url).hostname);
}
