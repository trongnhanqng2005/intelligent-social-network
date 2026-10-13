import { isEmail } from 'class-validator';

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid email');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !isEmail(email, { allow_utf8_local_part: false })) {
    throw new Error('Invalid email');
  }
  return email;
}

export function validatePassword(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid password');
  const codePoints = Array.from(value).length;
  if (codePoints < 15 || codePoints > 128 || Buffer.byteLength(value, 'utf8') > 512) {
    throw new Error('Invalid password');
  }
  return value;
}
