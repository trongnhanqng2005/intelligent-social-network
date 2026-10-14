import {
  decodeCursor,
  encodeCursor,
  normalizeDirectoryQuery,
  parseDirectoryLimit,
} from './user-directory.js';

const id = 'd723b01f-7048-4efd-80c7-2d59cfb88319';

describe('member directory rules', () => {
  it('treats blank queries as browse and folds Vietnamese accents and whitespace', () => {
    expect(normalizeDirectoryQuery('  \t ')).toBe('');
    expect(normalizeDirectoryQuery('  NGUYỄN   ĐẶNG ')).toBe('nguyen dang');
    expect(() => normalizeDirectoryQuery('a')).toThrow();
  });

  it('accepts only bounded integer page sizes', () => {
    expect(parseDirectoryLimit(undefined)).toBe(20);
    expect(parseDirectoryLimit(50)).toBe(50);
    for (const value of [0, 51, 1.5, '20', Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => parseDirectoryLimit(value)).toThrow();
    }
  });

  it('binds a bounded versioned cursor to its query and a UUID key', () => {
    const cursor = encodeCursor('nguyen', id);
    expect(cursor.length).toBeLessThanOrEqual(512);
    expect(decodeCursor(cursor, 'nguyen')).toBe(id);
    expect(() => decodeCursor(cursor, 'tran')).toThrow();
    expect(() => decodeCursor('not-a-cursor', 'nguyen')).toThrow();
  });

  it('canonicalizes UUID casing before using a cursor as a keyset boundary', () => {
    const cursor = Buffer.from(JSON.stringify({ v: 1, q: 'nguyen', id: id.toUpperCase() }), 'utf8').toString('base64url');
    expect(decodeCursor(cursor, 'nguyen')).toBe(id);
  });
});
