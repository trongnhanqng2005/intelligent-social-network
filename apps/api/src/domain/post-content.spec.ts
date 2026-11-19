import { normalizePostContent, PostContentValidationError } from './post-content.js';

describe('Post content validation', () => {
  it('normalizes NFC and line endings while retaining multiline text', () => {
    expect(normalizePostContent('  Cafe\u0301\r\nXin chào  ')).toBe('Café\nXin chào');
  });

  it('counts Unicode code points after normalization', () => {
    expect(normalizePostContent('e\u0301'.repeat(2000))).toBe('é'.repeat(2000));
    expect(() => normalizePostContent('a'.repeat(2001))).toThrow(PostContentValidationError);
  });

  it.each([
    '👨‍👩‍👧‍👦',
    '👩🏽‍💻',
    '❤️‍🔥',
    '🇻🇳',
    '1️⃣',
    '#️⃣',
    '👍🏽',
    'Xin chào 🌱',
  ])('accepts legitimate Vietnamese and composed emoji sequence %s', (content) => {
    expect(normalizePostContent(content)).toBe(content);
  });

  it.each(['', ' \n\t ', '\u200b', 'abc\u200dxyz', 'a\u202eb', 'a\u0001b', '\ud800'])
    ('rejects empty, invisible, unsafe or malformed content %j', (content) => {
      expect(() => normalizePostContent(content)).toThrow(PostContentValidationError);
    });

  it('rejects non-string input without coercion', () => {
    expect(() => normalizePostContent(42)).toThrow(PostContentValidationError);
    expect(() => normalizePostContent(null)).toThrow(PostContentValidationError);
  });
});
