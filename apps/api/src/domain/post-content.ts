export class PostContentValidationError extends Error {
  readonly field = 'content';

  constructor(message: string) {
    super(message);
    this.name = 'PostContentValidationError';
  }
}

const maxPostCodePoints = 2_000;
const bidiControl = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const controlCharacter = /^\p{Cc}$/u;
const formatCharacter = /^\p{Cf}$/u;
const markCharacter = /^\p{M}$/u;
const defaultIgnorable = /^\p{Default_Ignorable_Code_Point}$/u;
const extendedPictographic = /^\p{Extended_Pictographic}$/u;

export function normalizePostContent(input: unknown): string {
  if (typeof input !== 'string') {
    throw new PostContentValidationError('Nội dung bài viết phải là văn bản.');
  }

  const content = input.normalize('NFC').replace(/\r\n?/gu, '\n').trim();
  const characters = Array.from(content);
  if (!characters.some(isVisibleCharacter)) {
    throw new PostContentValidationError('Vui lòng nhập nội dung bài viết.');
  }
  if (characters.length > maxPostCodePoints) {
    throw new PostContentValidationError('Nội dung bài viết không được vượt quá 2.000 ký tự.');
  }

  const validTagIndexes = findValidEmojiTagIndexes(characters);
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]!;
    const point = character.codePointAt(0)!;

    if ((point >= 0xd800 && point <= 0xdfff) || bidiControl.test(character)) {
      throw new PostContentValidationError('Nội dung chứa ký tự không được phép.');
    }
    if (controlCharacter.test(character) && character !== '\n') {
      throw new PostContentValidationError('Nội dung chứa ký tự điều khiển không được phép.');
    }
    if (isEmojiModifier(point) && !hasEmojiBefore(characters, index)) {
      throw new PostContentValidationError('Nội dung chứa ký tự định dạng không được phép.');
    }
    if (point === 0x200d && !isEmojiJoiner(characters, index)) {
      throw new PostContentValidationError('Nội dung chứa ký tự định dạng không được phép.');
    }
    if (point === 0x20e3 && !isKeycapMark(characters, index)) {
      throw new PostContentValidationError('Nội dung chứa ký tự định dạng không được phép.');
    }
    if (isVariationSelector(point) && !hasEmojiBefore(characters, index) && !isKeycapSelector(characters, index)) {
      throw new PostContentValidationError('Nội dung chứa ký tự định dạng không được phép.');
    }
    if (formatCharacter.test(character) && point !== 0x200d && !validTagIndexes.has(index)) {
      throw new PostContentValidationError('Nội dung chứa ký tự định dạng không được phép.');
    }
    if (defaultIgnorable.test(character) && point !== 0x200d &&
        !isVariationSelector(point) && !validTagIndexes.has(index)) {
      throw new PostContentValidationError('Nội dung chứa ký tự ẩn không được phép.');
    }
  }

  return content;
}

export function countPostContentCodePoints(input: string): number {
  return Array.from(input.normalize('NFC').replace(/\r\n?/gu, '\n').trim()).length;
}

function isVisibleCharacter(character: string): boolean {
  return !/^\s$/u.test(character) && !markCharacter.test(character) &&
    !formatCharacter.test(character) && !isEmojiModifier(character.codePointAt(0)!);
}

function isEmojiJoiner(characters: string[], index: number): boolean {
  return hasEmojiBefore(characters, index) &&
    extendedPictographic.test(characters[index + 1] ?? '');
}

function hasEmojiBefore(characters: string[], index: number): boolean {
  let previous = index - 1;
  while (previous >= 0 && (markCharacter.test(characters[previous]!) ||
      isEmojiModifier(characters[previous]!.codePointAt(0)!))) previous -= 1;
  return previous >= 0 && extendedPictographic.test(characters[previous]!);
}

function isVariationSelector(point: number): boolean {
  return (point >= 0xfe00 && point <= 0xfe0f) || (point >= 0xe0100 && point <= 0xe01ef);
}

function isEmojiModifier(point: number): boolean {
  return point >= 0x1f3fb && point <= 0x1f3ff;
}

function isKeycapSelector(characters: string[], index: number): boolean {
  return /^[0-9#*]$/u.test(characters[index - 1] ?? '') && characters[index + 1]?.codePointAt(0) === 0x20e3;
}

function isKeycapMark(characters: string[], index: number): boolean {
  const previous = characters[index - 1];
  if (previous === '\ufe0f') return /^[0-9#*]$/u.test(characters[index - 2] ?? '');
  return /^[0-9#*]$/u.test(previous ?? '');
}

function findValidEmojiTagIndexes(characters: string[]): Set<number> {
  const valid = new Set<number>();
  for (let index = 0; index < characters.length; index += 1) {
    if (characters[index]!.codePointAt(0) !== 0x1f3f4) continue;
    let end = index + 1;
    while (end < characters.length) {
      const point = characters[end]!.codePointAt(0)!;
      if (point < 0xe0020 || point > 0xe007e) break;
      end += 1;
    }
    if (end === index + 1 || characters[end]?.codePointAt(0) !== 0xe007f) continue;
    for (let tag = index + 1; tag <= end; tag += 1) valid.add(tag);
  }
  return valid;
}
