import {
  createDefaultProfile,
  normalizeProfileField,
  normalizeSearchKey,
} from './user-profile.js';

describe('profile rules', () => {
  it('creates the approved UUID-derived default without account data', () => {
    expect(createDefaultProfile('d723b01f-7048-4efd-80c7-2d59cfb88319', '2026-10-14T10:00:00.000Z'))
      .toEqual({
        id: 'd723b01f-7048-4efd-80c7-2d59cfb88319',
        displayName: 'Thành viên d723b01f',
        bio: null,
        location: null,
        displayNameSearch: 'thanh vien d723b01f',
        profileCreatedAt: '2026-10-14T10:00:00.000Z',
        profileUpdatedAt: '2026-10-14T10:00:00.000Z',
        profileVersion: 0,
      });
  });

  it('normalizes and counts Unicode code points rather than UTF-16 units', () => {
    expect(() => normalizeProfileField('displayName', `A${String.fromCharCode(0)}B`)).toThrow();
    expect(normalizeProfileField('displayName', '  Nguyễn   Minh An  ')).toBe('Nguyễn Minh An');
    expect(normalizeProfileField('displayName', '😀😀')).toBe('😀😀');
    expect(() => normalizeProfileField('displayName', '😀'.repeat(81))).toThrow();
  });

  it('normalizes optional empty values to null and preserves biography line breaks', () => {
    expect(normalizeProfileField('bio', '  Mình thích dữ liệu.\r\n  Xin chào.  '))
      .toBe('Mình thích dữ liệu.\n  Xin chào.');
    expect(normalizeProfileField('bio', '   ')).toBeNull();
    expect(normalizeProfileField('location', null)).toBeNull();
    expect(normalizeProfileField('location', '  Đà   Nẵng  ')).toBe('Đà Nẵng');
  });

  it('rejects non-strings, controls, bidi controls and unpaired surrogates', () => {
    for (const value of [42, {}, `abc${String.fromCodePoint(0x202e)}`, String.fromCharCode(0xd800)]) {
      expect(() => normalizeProfileField('displayName', value)).toThrow();
    }
    expect(() => normalizeProfileField('bio', 'a\tb')).toThrow();
    expect(normalizeProfileField('bio', '👩‍💻')).toBe('👩‍💻');
  });

  it('matches Vietnamese names regardless of case or accents', () => {
    expect(normalizeSearchKey('  NGUYỄN   ĐẶNG  ')).toBe('nguyen dang');
    expect(normalizeSearchKey('Nguyễn')).toBe(normalizeSearchKey(`Nguye${String.fromCodePoint(0x0302, 0x0303)}n`));
  });
});
