import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';

interface WindowEntry {
  count: number;
  expiresAt: number;
}

@Injectable()
export class AuthRateLimiter {
  private readonly windows = new Map<string, WindowEntry>();
  private readonly maxEntries = 10_000;

  get size(): number {
    return this.windows.size;
  }

  consume(key: string, limit: number, windowMs: number, now = Date.now()): number {
    let entry = this.windows.get(key);
    if (!entry || entry.expiresAt <= now) {
      if (!entry && this.windows.size >= this.maxEntries) this.removeExpired(now);
      if (!entry && this.windows.size >= this.maxEntries) return Math.ceil(windowMs / 1000);
      entry = { count: 0, expiresAt: now + windowMs };
      this.windows.set(key, entry);
    }
    entry.count += 1;
    return entry.count > limit ? Math.max(1, Math.ceil((entry.expiresAt - now) / 1000)) : 0;
  }

  static identityKey(scope: string, normalizedIdentity: string): string {
    const digest = createHash('sha256').update(normalizedIdentity).digest('hex');
    return `${scope}:${digest}`;
  }

  private removeExpired(now: number): void {
    for (const [key, entry] of this.windows) {
      if (entry.expiresAt <= now) this.windows.delete(key);
    }
  }
}
