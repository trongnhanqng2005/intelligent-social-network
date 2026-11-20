import { Injectable } from '@nestjs/common';
import { Neo4jService } from '../../neo4j/neo4j.service.js';
import type { UserActivityWindow } from './admin.types.js';

@Injectable()
export class AdminRepository {
  constructor(private readonly neo4j: Neo4jService) {}

  async listUserActivityWindows(nowIso: string): Promise<UserActivityWindow[]> {
    return this.neo4j.executeRead(async (transaction) => {
      const result = await transaction.run(
        `WITH datetime($now) AS anchor,
              datetime($now) - duration('PT1H') AS since1h,
              datetime($now) - duration('PT24H') AS since24h
         MATCH (u:User)
         CALL (u, since1h, since24h, anchor) {
           OPTIONAL MATCH (u)-[:PERFORMED_AUTH_EVENT]->(ae:AuthActivityEvent)
           WHERE ae.timestamp >= since24h AND ae.timestamp <= anchor
           RETURN sum(CASE WHEN ae IS NOT NULL THEN 1 ELSE 0 END) AS auth24h,
                  sum(CASE WHEN ae IS NOT NULL AND ae.timestamp >= since1h THEN 1 ELSE 0 END) AS auth1h,
                  sum(CASE WHEN ae IS NOT NULL AND ae.eventType = 'AUTH_LOGIN_FAILED' THEN 1 ELSE 0 END) AS failedLogin24h,
                  sum(CASE WHEN ae IS NOT NULL AND ae.eventType = 'AUTH_LOGIN_FAILED' AND ae.timestamp >= since1h THEN 1 ELSE 0 END) AS failedLogin1h,
                  max(ae.timestamp) AS lastAuthAt
         }
         CALL (u, since1h, since24h, anchor) {
           OPTIONAL MATCH (pair:FriendshipPair)
           WHERE pair.senderId = u.id AND pair.requestedAt >= since24h AND pair.requestedAt <= anchor
           RETURN sum(CASE WHEN pair IS NOT NULL THEN 1 ELSE 0 END) AS friendReq24h,
                  sum(CASE WHEN pair IS NOT NULL AND pair.requestedAt >= since1h THEN 1 ELSE 0 END) AS friendReq1h,
                  collect(DISTINCT CASE WHEN pair IS NOT NULL AND pair.requestedAt >= since1h THEN pair.recipientId END) AS freqTargets1h,
                  collect(DISTINCT CASE WHEN pair IS NOT NULL THEN pair.recipientId END) AS freqTargets24h,
                  max(pair.requestedAt) AS lastFriendReqAt
         }
         CALL (u, since1h, since24h, anchor) {
           OPTIONAL MATCH (u)-[:AUTHORED]->(p:Post)
           WHERE p.createdAt >= since24h AND p.createdAt <= anchor
           RETURN sum(CASE WHEN p IS NOT NULL THEN 1 ELSE 0 END) AS post24h,
                  sum(CASE WHEN p IS NOT NULL AND p.createdAt >= since1h THEN 1 ELSE 0 END) AS post1h,
                  max(p.createdAt) AS lastPostAt
         }
         CALL (u, since1h, since24h, anchor) {
           OPTIONAL MATCH (u)-[:WROTE_COMMENT]->(c:Comment)
           WHERE c.createdAt >= since24h AND c.createdAt <= anchor
           OPTIONAL MATCH (c)-[:ON_POST]->(cp:Post)
           RETURN sum(CASE WHEN c IS NOT NULL THEN 1 ELSE 0 END) AS comment24h,
                  sum(CASE WHEN c IS NOT NULL AND c.createdAt >= since1h THEN 1 ELSE 0 END) AS comment1h,
                  collect(DISTINCT CASE WHEN c IS NOT NULL AND c.createdAt >= since1h THEN cp.authorId END) AS commentTargets1h,
                  collect(DISTINCT CASE WHEN c IS NOT NULL THEN cp.authorId END) AS commentTargets24h,
                  max(c.createdAt) AS lastCommentAt
         }
         RETURN u.id AS userId, u.email AS email, u.displayName AS displayName,
                auth1h, auth24h, failedLogin1h, failedLogin24h,
                friendReq1h, friendReq24h,
                post1h, post24h, comment1h, comment24h,
                freqTargets1h, freqTargets24h, commentTargets1h, commentTargets24h,
                toString(lastAuthAt) AS lastAuthAt,
                toString(lastFriendReqAt) AS lastFriendReqAt,
                toString(lastPostAt) AS lastPostAt,
                toString(lastCommentAt) AS lastCommentAt`,
        { now: nowIso },
      );

      return result.records.map((record) => {
        const userId = String(record.get('userId'));
        const distinctTargets1h = countDistinctTargets(
          userId,
          record.get('freqTargets1h'),
          record.get('commentTargets1h'),
        );
        const distinctTargets24h = countDistinctTargets(
          userId,
          record.get('freqTargets24h'),
          record.get('commentTargets24h'),
        );

        return {
          userId,
          email: String(record.get('email')),
          displayName: String(record.get('displayName') ?? record.get('email')),
          auth1h: asCount(record.get('auth1h')),
          auth24h: asCount(record.get('auth24h')),
          failedLogin1h: asCount(record.get('failedLogin1h')),
          failedLogin24h: asCount(record.get('failedLogin24h')),
          friendReq1h: asCount(record.get('friendReq1h')),
          friendReq24h: asCount(record.get('friendReq24h')),
          post1h: asCount(record.get('post1h')),
          post24h: asCount(record.get('post24h')),
          comment1h: asCount(record.get('comment1h')),
          comment24h: asCount(record.get('comment24h')),
          distinctTargets1h,
          distinctTargets24h,
          lastActivityAt: latestTimestamp([
            record.get('lastAuthAt'),
            record.get('lastFriendReqAt'),
            record.get('lastPostAt'),
            record.get('lastCommentAt'),
          ]),
        };
      });
    });
  }
}

function countDistinctTargets(selfId: string, ...groups: unknown[]): number {
  const targets = new Set<string>();
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const item of group) {
      if (typeof item === 'string' && item.length > 0 && item !== selfId) {
        targets.add(item);
      }
    }
  }
  return targets.size;
}

function latestTimestamp(values: unknown[]): string | null {
  let latest: { iso: string; millis: number } | undefined;
  for (const value of values) {
    if (typeof value !== 'string' || !value) continue;
    const millis = Date.parse(value);
    if (!Number.isFinite(millis)) continue;
    if (!latest || millis > latest.millis) {
      latest = { iso: value, millis };
    }
  }
  return latest?.iso ?? null;
}

function asCount(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'object' && value !== null && 'toNumber' in value && typeof value.toNumber === 'function') {
    const n = value.toNumber();
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
