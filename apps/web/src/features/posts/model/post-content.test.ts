import { describe, expect, it } from 'vitest';
import { countPostContentCodePoints, normalizePostDraft } from './post-content';

describe('Post draft Unicode counting', () => {
  it('counts normalized Unicode code points, not UTF-16 code units or grapheme clusters', () => {
    expect(countPostContentCodePoints('e\u0301')).toBe(1);
    expect(countPostContentCodePoints('👨‍👩‍👧‍👦')).toBe(7);
    expect(countPostContentCodePoints('🇻🇳')).toBe(2);
    expect(countPostContentCodePoints('👍🏽')).toBe(2);
  });

  it('uses the API newline and trimming normalization for its counter', () => {
    expect(normalizePostDraft('  Cafe\u0301\r\nXin chào  ')).toBe('Café\nXin chào');
    expect(countPostContentCodePoints('  Cafe\u0301\r\nXin chào  ')).toBe(13);
  });

  it('counts the 2,000 code-point boundary consistently', () => {
    expect(countPostContentCodePoints('🌱'.repeat(2000))).toBe(2000);
    expect(countPostContentCodePoints('🌱'.repeat(2001))).toBe(2001);
  });
});
