import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import argon2 from 'argon2';
import { validatePassword } from './identity.js';

const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  private activeHashes = 0;

  async hash(password: string): Promise<string> {
    validatePassword(password);
    return this.withCapacity(() => argon2.hash(password, HASH_OPTIONS));
  }

  async verify(hash: string, password: string): Promise<boolean> {
    const parts = hash.split('$');
    if (parts.length !== 6 || parts[1] !== 'argon2id' || !/^v=\d+$/.test(parts[2] ?? '') ||
        !/m=\d+/.test(parts[3] ?? '') || !/t=\d+/.test(parts[3] ?? '') || !/p=\d+/.test(parts[3] ?? '') ||
        !parts[4] || !parts[5]) return false;
    if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 512) return false;
    return this.withCapacity(async () => {
      try {
        return await argon2.verify(hash, password);
      } catch {
        return false;
      }
    });
  }

  async dummyVerify(password: string): Promise<void> {
    await this.verify(DUMMY_HASH, password.slice(0, 512));
  }

  needsRehash(hash: string): boolean {
    try {
      return argon2.needsRehash(hash, HASH_OPTIONS);
    } catch {
      return true;
    }
  }

  private async withCapacity<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activeHashes >= 4) throw new ServiceUnavailableException('Authentication capacity unavailable');
    this.activeHashes += 1;
    try {
      return await operation();
    } finally {
      this.activeHashes -= 1;
    }
  }
}

// Fixed dummy hash prevents an unknown-email login from skipping the expensive verification path.
const DUMMY_HASH = '$argon2id$v=19$m=19456,p=1,t=2$MDEyMzQ1Njc4OWFiY2RlZg$Hw+LZVj8bZItHEzTmRnAQCF6s3ng7oHs1E4DxuKSDjo';
