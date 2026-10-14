import { Injectable } from '@nestjs/common';
import { int } from 'neo4j-driver';
import { Neo4jService } from '../../neo4j/neo4j.service.js';
import type { OwnProfile, ProfileUpdate, ProfileUpdateResult, PublicProfile } from './users.types.js';

@Injectable()
export class UsersRepository {
  constructor(private readonly neo4j: Neo4jService) {}

  async findOwnProfile(userId: string): Promise<OwnProfile | undefined> {
    return this.neo4j.executeRead(async (transaction) => {
      const result = await transaction.run(
        `MATCH (user:User {id: $userId})
         RETURN user.id AS id, user.displayName AS displayName,
                user.bio AS bio, user.location AS location,
                toString(user.profileCreatedAt) AS createdAt,
                toString(user.profileUpdatedAt) AS updatedAt,
                user.profileVersion AS version LIMIT 1`,
        { userId },
      );
      const record = result.records[0];
      return record ? {
        ...readPublicProfile(record),
        createdAt: String(record.get('createdAt')),
        updatedAt: String(record.get('updatedAt')),
        version: asNumber(record.get('version')),
      } : undefined;
    });
  }

  async findPublicProfile(userId: string): Promise<PublicProfile | undefined> {
    return this.neo4j.executeRead(async (transaction) => {
      const result = await transaction.run(
        `MATCH (user:User {id: $userId})
         RETURN user.id AS id, user.displayName AS displayName,
                user.bio AS bio, user.location AS location LIMIT 1`,
        { userId },
      );
      return result.records[0] ? readPublicProfile(result.records[0]) : undefined;
    });
  }

  async listPublicProfiles(input: {
    userId: string; query: string; afterId?: string; fetchLimit: number;
  }): Promise<PublicProfile[]> {
    return this.neo4j.executeRead(async (transaction) => {
      const filters = ['user.id <> $userId'];
      if (input.query) filters.push('user.displayNameSearch CONTAINS $query');
      if (input.afterId) filters.push('user.id > $afterId');
      const result = await transaction.run(
        `MATCH (user:User)
         WHERE ${filters.join('\n           AND ')}
         RETURN user.id AS id, user.displayName AS displayName,
                user.bio AS bio, user.location AS location
         ORDER BY user.id ASC LIMIT $fetchLimit`,
        { ...input, afterId: input.afterId ?? null, fetchLimit: int(input.fetchLimit) },
      );
      return result.records.map(readPublicProfile);
    });
  }

  async updateProfile(input: ProfileUpdate): Promise<ProfileUpdateResult> {
    return this.neo4j.executeWrite(async (transaction) => {
      const result = await transaction.run(
        `MATCH (user:User {id: $userId})
         SET user.profileVersion = user.profileVersion + 0
         WITH user, user.profileVersion AS currentVersion
         WHERE currentVersion = $expectedVersion
         SET user.displayName = CASE WHEN $changeDisplayName THEN $displayName ELSE user.displayName END,
             user.displayNameSearch = CASE WHEN $changeDisplayName THEN $displayNameSearch ELSE user.displayNameSearch END,
             user.bio = CASE WHEN $changeBio THEN $bio ELSE user.bio END,
             user.location = CASE WHEN $changeLocation THEN $location ELSE user.location END,
             user.profileUpdatedAt = datetime($updatedAt),
             user.profileVersion = currentVersion + 1
         RETURN user.id AS id, user.displayName AS displayName,
                user.bio AS bio, user.location AS location,
                toString(user.profileCreatedAt) AS createdAt,
                toString(user.profileUpdatedAt) AS updatedAt,
                user.profileVersion AS version LIMIT 1`,
        {
          userId: input.userId,
          expectedVersion: input.expectedVersion,
          changeDisplayName: input.displayName !== undefined,
          displayName: input.displayName ?? '',
          displayNameSearch: input.displayNameSearch ?? '',
          changeBio: input.bio !== undefined,
          bio: input.bio ?? null,
          changeLocation: input.location !== undefined,
          location: input.location ?? null,
          updatedAt: input.updatedAt,
        },
      );
      const record = result.records[0];
      if (record) {
        return {
          status: 'updated',
          profile: {
            ...readPublicProfile(record),
            createdAt: String(record.get('createdAt')),
            updatedAt: String(record.get('updatedAt')),
            version: asNumber(record.get('version')),
          },
        };
      }

      const existing = await transaction.run(
        'MATCH (user:User {id: $userId}) RETURN user.id AS id LIMIT 1',
        { userId: input.userId },
      );
      return existing.records.length ? { status: 'conflict' } : { status: 'not-found' };
    });
  }
}

function readPublicProfile(record: { get(key: string): unknown }): PublicProfile {
  return {
    id: String(record.get('id')),
    displayName: String(record.get('displayName')),
    bio: nullableString(record.get('bio')),
    location: nullableString(record.get('location')),
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null && 'toNumber' in value && typeof value.toNumber === 'function') {
    return value.toNumber();
  }
  return 0;
}
