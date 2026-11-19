import { randomUUID } from 'node:crypto';
import type { Transaction } from 'neo4j-driver';

export const activityEventTypes = [
  'FRIEND_REQUEST_CREATED', 'FRIEND_REQUEST_ACCEPTED', 'FRIEND_REQUEST_REJECTED',
  'FRIEND_REQUEST_CANCELLED', 'FRIENDSHIP_REMOVED', 'POST_CREATED', 'POST_UPDATED',
  'POST_DELETED', 'POST_LIKED', 'POST_UNLIKED', 'COMMENT_CREATED', 'COMMENT_UPDATED',
  'COMMENT_DELETED',
] as const;

export type ActivityEventType = (typeof activityEventTypes)[number];
export type ActivityEvent = {
  eventId: string;
  schemaVersion: 1;
  eventType: ActivityEventType;
  occurredAt: string;
  source: 'APPLICATION';
  actorId: string;
  targetUserId?: string;
  objectType: 'FRIENDSHIP_REQUEST' | 'FRIENDSHIP' | 'POST' | 'COMMENT';
  objectId: string;
};

export function activityCaptureEnabled(): boolean {
  if (process.env.ACTIVITY_CAPTURE_ENABLED !== 'true') return false;
  let host: string | undefined;
  try { host = new URL(process.env.NEO4J_URI ?? '').hostname; } catch { /* fail closed below */ }
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
  if (process.env.NODE_ENV !== 'test' || process.env.NEO4J_DATABASE !== 'isn-test' ||
      process.env.ISN_TEST_WRITE_WINDOW !== 'owner-approved' || !loopback) {
    throw new Error('Activity capture requires the guarded local isn-test write window');
  }
  return true;
}

export function newActivityEvent(input: Omit<ActivityEvent, 'eventId' | 'schemaVersion' | 'source'>): ActivityEvent {
  return { ...input, eventId: randomUUID(), schemaVersion: 1, source: 'APPLICATION' };
}

export async function recordActivityEvent(tx: Pick<Transaction, 'run'>, event: ActivityEvent): Promise<void> {
  if (!activityCaptureEnabled()) return;
  await tx.run(
    `CREATE (:ActivityEvent {
       eventId: $eventId, schemaVersion: $schemaVersion, eventType: $eventType,
       occurredAt: datetime($occurredAt), source: $source, actorId: $actorId,
       targetUserId: $targetUserId, objectType: $objectType, objectId: $objectId
     })`,
    { ...event, targetUserId: event.targetUserId ?? null },
  );
}
