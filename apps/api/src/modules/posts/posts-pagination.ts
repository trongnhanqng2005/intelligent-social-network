import { PostException } from './posts.errors.js';

const VERSION = 'v1';

export function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ v: VERSION, createdAt, id }), 'utf8').toString('base64url');
}

export function decodeCursor(value: unknown): { createdAt: string; id: string } | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > 512) throw invalidCursor();
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (decoded.v !== VERSION || typeof decoded.createdAt !== 'string' || typeof decoded.id !== 'string') throw invalidCursor();
    return { createdAt: decoded.createdAt, id: decoded.id };
  } catch {
    throw invalidCursor();
  }
}

export function parseLimit(value: unknown): number {
  if (value === undefined) return 20;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 50) {
    throw new PostException(422, 'VALIDATION_ERROR', 'Dữ liệu phân trang không hợp lệ.', { limit: ['Giới hạn phải từ 1 đến 50.'] });
  }
  return value;
}

function invalidCursor(): PostException {
  return new PostException(422, 'VALIDATION_ERROR', 'Dữ liệu phân trang không hợp lệ.', { cursor: ['Cursor không hợp lệ.'] });
}
