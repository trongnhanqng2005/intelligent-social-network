export type ProfileField = 'displayName' | 'bio' | 'location';

export interface DefaultProfile {
  id: string;
  displayName: string;
  bio: null;
  location: null;
  displayNameSearch: string;
  profileCreatedAt: string;
  profileUpdatedAt: string;
  profileVersion: 0;
}

const fieldLimits: Record<ProfileField, { min: number; max: number }> = {
  displayName: { min: 2, max: 80 },
  bio: { min: 0, max: 280 },
  location: { min: 0, max: 80 },
};

export class ProfileValidationError extends Error {
  constructor(readonly field: ProfileField | 'q' | 'cursor' | 'limit' | 'expectedVersion', message: string) {
    super(message);
    this.name = 'ProfileValidationError';
  }
}

export function createDefaultProfile(id: string, now: string): DefaultProfile {
  const displayName = `Thành viên ${id.slice(0, 8)}`;
  return {
    id,
    displayName,
    bio: null,
    location: null,
    displayNameSearch: normalizeSearchKey(displayName),
    profileCreatedAt: now,
    profileUpdatedAt: now,
    profileVersion: 0,
  };
}

export function normalizeProfileField(field: ProfileField, input: unknown): string | null {
  if (field !== 'displayName' && input === null) return null;
  if (typeof input !== 'string') {
    throw new ProfileValidationError(field, 'Vui lòng nhập văn bản hợp lệ.');
  }

  let value = input.normalize('NFC').replace(/\r\n?/gu, '\n');
  validateCharacters(value, field, field === 'bio');
  value = field === 'bio' ? value.trim() : value.trim().replace(/\s+/gu, ' ');

  if (field !== 'displayName' && value.length === 0) return null;

  const length = [...value].length;
  const { min, max } = fieldLimits[field];
  if (length < min || length > max) {
    const message = field === 'displayName'
      ? 'Tên hiển thị phải có từ 2 đến 80 ký tự.'
      : field === 'bio'
        ? 'Giới thiệu không được vượt quá 280 ký tự.'
        : 'Địa điểm không được vượt quá 80 ký tự.';
    throw new ProfileValidationError(field, message);
  }
  return value;
}

export function normalizeSearchKey(value: string): string {
  return value.normalize('NFC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLowerCase()
    .replace(/đ/gu, 'd')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .normalize('NFC');
}

function validateCharacters(value: string, field: ProfileField, allowLineFeed: boolean): void {
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if ((point >= 0xd800 && point <= 0xdfff) ||
        (point >= 0x202a && point <= 0x202e) ||
        (point >= 0x2066 && point <= 0x2069) || point === 0x061c || point === 0x200e || point === 0x200f) {
      throw new ProfileValidationError(field, 'Văn bản chứa ký tự không được phép.');
    }

    if (/\p{Cc}/u.test(character) && !(allowLineFeed && character === '\n')) {
      throw new ProfileValidationError(field, 'Văn bản chứa ký tự điều khiển không được phép.');
    }

    if (/\p{Cf}/u.test(character) && point !== 0x200c && point !== 0x200d) {
      throw new ProfileValidationError(field, 'Văn bản chứa ký tự định dạng không được phép.');
    }
  }
}
