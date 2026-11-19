import { ProfileValidationError } from '../../domain/user-profile.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const maxCursorLength = 512;

export type FriendshipListScope = 'requests' | 'friends';
export type FriendshipRequestDirection = 'received' | 'sent';

interface FriendshipCursorInput {
  scope: FriendshipListScope;
  viewerId: string;
  direction?: FriendshipRequestDirection;
  lastId: string;
}

interface FriendshipCursorExpectation {
  scope: FriendshipListScope;
  viewerId: string;
  direction?: FriendshipRequestDirection;
}

export function parseFriendshipLimit(value: unknown): number {
  if (value === undefined) return 20;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 50) {
    throw new ProfileValidationError('limit', 'Số kết quả phải nằm trong khoảng từ 1 đến 50.');
  }
  return value;
}

export function encodeFriendshipCursor(input: FriendshipCursorInput): string {
  if (!uuidPattern.test(input.viewerId) || !uuidPattern.test(input.lastId)) {
    throw new TypeError('Cannot encode a cursor for invalid friendship IDs');
  }
  const payload = {
    v: 1,
    scope: input.scope,
    viewerId: input.viewerId.toLowerCase(),
    direction: input.direction ?? null,
    lastId: input.lastId.toLowerCase(),
  };
  const cursor = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  if (cursor.length > maxCursorLength) throw new Error('Friendship cursor exceeds its size limit');
  return cursor;
}

export function decodeFriendshipCursor(
  value: unknown,
  expected: FriendshipCursorExpectation,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0 || value.length > maxCursorLength) {
    throw new ProfileValidationError('cursor', 'Trang danh sách không hợp lệ.');
  }
  try {
    const json = Buffer.from(value, 'base64url').toString('utf8');
    if (Buffer.from(json, 'utf8').toString('base64url') !== value) throw new Error('Non-canonical cursor');
    const payload: unknown = JSON.parse(json);
    const requiredKeys = expected.direction === undefined
      ? 'direction,lastId,scope,v,viewerId'
      : 'direction,lastId,scope,v,viewerId';
    if (typeof payload !== 'object' || payload === null ||
        Object.keys(payload).sort().join(',') !== requiredKeys ||
        !('v' in payload) || payload.v !== 1 ||
        !('scope' in payload) || payload.scope !== expected.scope ||
        !('viewerId' in payload) || payload.viewerId !== expected.viewerId.toLowerCase() ||
        !('direction' in payload) || payload.direction !== (expected.direction ?? null) ||
        !('lastId' in payload) || typeof payload.lastId !== 'string' || !uuidPattern.test(payload.lastId)) {
      throw new Error('Invalid cursor payload');
    }
    return payload.lastId.toLowerCase();
  } catch {
    throw new ProfileValidationError('cursor', 'Trang danh sách không hợp lệ.');
  }
}
