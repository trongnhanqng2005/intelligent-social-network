import {
  decodePostsCursor,
  encodePostsCursor,
  parsePostsLimit,
  type PostsCursor,
} from './post-pagination.js';

const viewerId = '11111111-1111-4111-8111-111111111111';
const authorId = '22222222-2222-4222-8222-222222222222';
const postId = '33333333-3333-4333-8333-333333333333';
const createdAt = '2026-10-15T10:00:00.000Z';

describe('Posts pagination', () => {
  it('uses the bounded default and accepts limits from 1 through 50', () => {
    expect(parsePostsLimit(undefined)).toBe(20);
    expect(parsePostsLimit(1)).toBe(1);
    expect(parsePostsLimit(50)).toBe(50);
    for (const value of [0, 51, 1.5, '20', null]) expect(() => parsePostsLimit(value)).toThrow();
  });

  it('round-trips a cursor bound to viewer, scope and profile author', () => {
    const cursor: PostsCursor = {
      scope: 'profile-posts', viewerId, authorId, lastCreatedAt: createdAt, lastId: postId,
    };
    const encoded = encodePostsCursor(cursor);
    expect(decodePostsCursor(encoded, { scope: 'profile-posts', viewerId, authorId })).toEqual(cursor);
  });

  it('round-trips the feed cursor with no profile author', () => {
    const cursor: PostsCursor = {
      scope: 'feed', viewerId, authorId: null, lastCreatedAt: createdAt, lastId: postId,
    };
    const encoded = encodePostsCursor(cursor);
    expect(decodePostsCursor(encoded, { scope: 'feed', viewerId, authorId: null })).toEqual(cursor);
  });

  it('rejects malformed, oversized, cross-viewer, cross-scope and cross-author cursors', () => {
    const encoded = encodePostsCursor({
      scope: 'profile-posts', viewerId, authorId, lastCreatedAt: createdAt, lastId: postId,
    });
    for (const value of ['', 'not-base64', 'e30', 'a'.repeat(513)]) {
      expect(() => decodePostsCursor(value, { scope: 'profile-posts', viewerId, authorId })).toThrow();
    }
    expect(() => decodePostsCursor(encoded, { scope: 'feed', viewerId, authorId: null })).toThrow();
    expect(() => decodePostsCursor(encoded, { scope: 'profile-posts', viewerId: authorId, authorId })).toThrow();
    expect(() => decodePostsCursor(encoded, { scope: 'profile-posts', viewerId, authorId: viewerId })).toThrow();
  });

  it('rejects a noncanonical cursor payload and invalid timestamp', () => {
    const payload = {
      v: 1, scope: 'feed', viewerId, authorId: null, lastCreatedAt: 'not-a-date', lastId: postId, extra: true,
    };
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    expect(() => decodePostsCursor(encoded, { scope: 'feed', viewerId, authorId: null })).toThrow();
  });
});
