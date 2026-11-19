export function normalizePostDraft(value: string): string {
  return value.normalize('NFC').replace(/\r\n?/gu, '\n').trim();
}

export function countPostContentCodePoints(value: string): number {
  return Array.from(normalizePostDraft(value)).length;
}
