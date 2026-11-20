import type { ConfigService } from '@nestjs/config';

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Checks whether `userId` belongs to a strict comma-separated list of canonical UUIDs
 * stored under `configKey`. Fails closed when config is missing or malformed.
 */
export function isAllowedUserId(
  config: Pick<ConfigService, 'get'> | undefined,
  configKey: string,
  userId: string,
): boolean {
  if (!config || !CANONICAL_UUID.test(userId)) return false;
  const raw = config.get<unknown>(configKey);
  if (typeof raw !== 'string' || raw.length > 4096) return false;
  const entries = raw.split(',');
  if (entries.length > 32 || entries.some((entry) => !CANONICAL_UUID.test(entry))) return false;
  return entries.includes(userId);
}
