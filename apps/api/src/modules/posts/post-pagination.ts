export type PostsCursor =
  | {
      scope: 'feed';
      viewerId: string;
      authorId: null;
      lastCreatedAt: string;
      lastId: string;
    }
  | {
      scope: 'profile-posts';
      viewerId: string;
      authorId: string;
      lastCreatedAt: string;
      lastId: string;
    };

export type PostsCursorExpectation =
  | { scope: 'feed'; viewerId: string; authorId: null }
  | { scope: 'profile-posts'; viewerId: string; authorId: string };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const maxCursorLength = 512;

export class PostsPaginationError extends Error {
  readonly field: 'limit' | 'cursor';

  constructor(field: 'limit' | 'cursor', message: string) {
    super(message);
    this.name = 'PostsPaginationError';
    this.field = field;
  }
}

export function parsePostsLimit(value: unknown): number {
  if (value === undefined) return 20;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 50) {
    throw new PostsPaginationError('limit', 'Số bài viết phải nằm trong khoảng từ 1 đến 50.');
  }
  return value;
}

export function encodePostsCursor(cursor: PostsCursor): string {
  if (!uuidPattern.test(cursor.viewerId) || !uuidPattern.test(cursor.lastId) ||
      (cursor.authorId !== null && !uuidPattern.test(cursor.authorId)) || !isValidTimestamp(cursor.lastCreatedAt)) {
    throw new TypeError('Cannot encode a cursor with invalid Post pagination values');
  }
  const payload = {
    v: 1,
    scope: cursor.scope,
    viewerId: cursor.viewerId.toLowerCase(),
    authorId: cursor.authorId?.toLowerCase() ?? null,
    lastCreatedAt: cursor.lastCreatedAt,
    lastId: cursor.lastId.toLowerCase(),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  if (encoded.length > maxCursorLength) throw new Error('Posts cursor exceeds its size limit');
  return encoded;
}

export function decodePostsCursor(
  value: unknown,
  expected: PostsCursorExpectation,
): PostsCursor | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0 || value.length > maxCursorLength) {
    throw new PostsPaginationError('cursor', 'Trang bài viết không hợp lệ.');
  }

  try {
    const json = Buffer.from(value, 'base64url').toString('utf8');
    if (Buffer.from(json, 'utf8').toString('base64url') !== value) throw new Error('Noncanonical cursor');
    const payload: unknown = JSON.parse(json);
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new Error('Invalid cursor');
    const record = payload as Record<string, unknown>;
    const keys = ['authorId', 'lastCreatedAt', 'lastId', 'scope', 'v', 'viewerId'].sort().join(',');
    if (Object.keys(record).sort().join(',') !== keys || record.v !== 1 ||
        record.scope !== expected.scope || record.viewerId !== expected.viewerId.toLowerCase() ||
        record.authorId !== (expected.authorId?.toLowerCase() ?? null) ||
        typeof record.lastId !== 'string' || !uuidPattern.test(record.lastId) || record.lastId !== record.lastId.toLowerCase() ||
        typeof record.lastCreatedAt !== 'string' || !isValidTimestamp(record.lastCreatedAt)) {
      throw new Error('Cursor does not match the expected list');
    }
    return {
      scope: expected.scope,
      viewerId: record.viewerId as string,
      authorId: expected.authorId,
      lastCreatedAt: record.lastCreatedAt,
      lastId: record.lastId.toLowerCase(),
    } as PostsCursor;
  } catch {
    throw new PostsPaginationError('cursor', 'Trang bài viết không hợp lệ.');
  }
}

function isValidTimestamp(value: string): boolean {
  return timestampPattern.test(value) && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}
