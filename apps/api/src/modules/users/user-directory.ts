import { ProfileValidationError, normalizeSearchKey } from '../../domain/user-profile.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const maxCursorLength = 512;

export function normalizeDirectoryQuery(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') {
    throw new ProfileValidationError('q', 'Truy vấn tìm kiếm không hợp lệ.');
  }
  const query = normalizeSearchKey(value);
  if (query.length === 0) return '';
  const length = [...query].length;
  if (length < 2 || length > 80) {
    throw new ProfileValidationError('q', 'Từ khóa tìm kiếm phải có từ 2 đến 80 ký tự.');
  }
  return query;
}

export function parseDirectoryLimit(value: unknown): number {
  if (value === undefined) return 20;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 50) {
    throw new ProfileValidationError('limit', 'Số kết quả phải nằm trong khoảng từ 1 đến 50.');
  }
  return value;
}

export function encodeCursor(query: string, id: string): string {
  if (!uuidPattern.test(id)) throw new Error('Cannot create a directory cursor for an invalid member ID');
  const cursor = Buffer.from(JSON.stringify({ v: 1, q: query, id }), 'utf8').toString('base64url');
  if (cursor.length > maxCursorLength) throw new Error('Directory cursor exceeds its size limit');
  return cursor;
}

export function decodeCursor(value: unknown, query: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0 || value.length > maxCursorLength) {
    throw new ProfileValidationError('cursor', 'Trang tìm kiếm không hợp lệ.');
  }

  try {
    const json = Buffer.from(value, 'base64url').toString('utf8');
    if (Buffer.from(json, 'utf8').toString('base64url') !== value) throw new Error('Non-canonical cursor');
    const payload: unknown = JSON.parse(json);
    if (typeof payload !== 'object' || payload === null ||
        Object.keys(payload).sort().join(',') !== 'id,q,v' ||
        !('v' in payload) || payload.v !== 1 ||
        !('q' in payload) || payload.q !== query ||
        !('id' in payload) || typeof payload.id !== 'string' || !uuidPattern.test(payload.id)) {
      throw new Error('Invalid cursor payload');
    }
    return payload.id.toLowerCase();
  } catch {
    throw new ProfileValidationError('cursor', 'Trang tìm kiếm không hợp lệ.');
  }
}
