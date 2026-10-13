import { Injectable } from '@nestjs/common';
import type { Neo4jError } from 'neo4j-driver';
import { Neo4jService } from '../../neo4j/neo4j.service.js';

export interface AuthUser {
  id: string;
  email: string;
}

export interface Credentials extends AuthUser {
  passwordHash: string;
}

@Injectable()
export class AuthRepository {
  constructor(private readonly neo4j: Neo4jService) {}

  async register(input: {
    id: string; email: string; passwordHash: string; eventId: string; now: string;
  }): Promise<AuthUser> {
    try {
      return await this.neo4j.executeWrite(async (tx) => {
        const result = await tx.run(
          `CREATE (user:User {
             id: $id, email: $email, passwordHash: $passwordHash,
             createdAt: datetime($now), updatedAt: datetime($now)
           })
           CREATE (event:AuthActivityEvent {
             eventId: $eventId, schemaVersion: 1, eventType: 'AUTH_REGISTERED',
             timestamp: datetime($now), source: 'APPLICATION', userId: $id
           })
           CREATE (user)-[:PERFORMED_AUTH_EVENT]->(event)
           RETURN user.id AS id, user.email AS email`,
          input,
        );
        const record = result.records[0];
        if (!record) throw new Error('Registration persistence returned no user');
        return { id: String(record.get('id')), email: String(record.get('email')) };
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) throw new AccountConflictError();
      throw error;
    }
  }

  async findCredentials(email: string): Promise<Credentials | undefined> {
    return this.neo4j.executeRead(async (tx) => {
      const result = await tx.run(
        `MATCH (user:User {email: $email})
         RETURN user.id AS id, user.email AS email, user.passwordHash AS passwordHash LIMIT 1`,
        { email },
      );
      const record = result.records[0];
      return record ? {
        id: String(record.get('id')),
        email: String(record.get('email')),
        passwordHash: String(record.get('passwordHash')),
      } : undefined;
    });
  }

  async createSession(input: {
    user: AuthUser; expectedPasswordHash: string; replacementPasswordHash?: string;
    id: string; jti: string; eventId: string; now: string; expiresAt: string;
  }): Promise<boolean> {
    return this.neo4j.executeWrite(async (tx) => {
      const result = await tx.run(
        `MATCH (user:User {id: $userId, email: $email})
         WHERE user.passwordHash = $expectedPasswordHash
         SET user.passwordHash = CASE WHEN $replacementPasswordHash IS NULL
                                      THEN user.passwordHash ELSE $replacementPasswordHash END
         CREATE (session:AuthSession {
           id: $id, jti: $jti, createdAt: datetime($now), expiresAt: datetime($expiresAt)
         })
         CREATE (user)-[:HAS_AUTH_SESSION]->(session)
         CREATE (event:AuthActivityEvent {
           eventId: $eventId, schemaVersion: 1, eventType: 'AUTH_LOGIN_SUCCEEDED',
           timestamp: datetime($now), source: 'APPLICATION', userId: $userId, sessionId: $id
         })
         CREATE (user)-[:PERFORMED_AUTH_EVENT]->(event)
         RETURN session.jti AS jti`,
        {
          userId: input.user.id,
          email: input.user.email,
          expectedPasswordHash: input.expectedPasswordHash,
          replacementPasswordHash: input.replacementPasswordHash ?? null,
          id: input.id,
          jti: input.jti,
          eventId: input.eventId,
          now: input.now,
          expiresAt: input.expiresAt,
        },
      );
      return result.records.length === 1;
    });
  }

  async findActiveSession(
    userId: string,
    jti: string,
    expectedExpiresAt: string,
  ): Promise<(AuthUser & { expiresAt: string }) | undefined> {
    return this.neo4j.executeRead(async (tx) => {
      const result = await tx.run(
        `MATCH (user:User {id: $userId})-[:HAS_AUTH_SESSION]->(session:AuthSession {jti: $jti})
         WHERE session.revokedAt IS NULL
           AND session.expiresAt = datetime($expectedExpiresAt)
           AND session.expiresAt > datetime()
         RETURN user.id AS id, user.email AS email, toString(session.expiresAt) AS expiresAt LIMIT 1`,
        { userId, jti, expectedExpiresAt },
      );
      const record = result.records[0];
      return record ? {
        id: String(record.get('id')),
        email: String(record.get('email')),
        expiresAt: String(record.get('expiresAt')),
      } : undefined;
    });
  }

  async revokeSession(input: {
    userId: string; jti: string; eventId: string; now: string;
  }): Promise<boolean> {
    return this.neo4j.executeWrite(async (tx) => {
      // A dependent SET on the existing expiry takes the session write lock. Keep the
      // state predicate in a subsequent statement so concurrent logouts serialize.
      await tx.run(
        `MATCH (:User {id: $userId})-[:HAS_AUTH_SESSION]->(session:AuthSession {jti: $jti})
         SET session.expiresAt = session.expiresAt
         RETURN session.jti AS jti`,
        input,
      );
      const result = await tx.run(
        `MATCH (user:User {id: $userId})-[:HAS_AUTH_SESSION]->(session:AuthSession {jti: $jti})
         WHERE session.revokedAt IS NULL
         SET session.revokedAt = datetime($now)
         CREATE (event:AuthActivityEvent {
           eventId: $eventId, schemaVersion: 1, eventType: 'AUTH_LOGOUT',
           timestamp: datetime($now), source: 'APPLICATION', userId: $userId,
           sessionId: session.id
         })
         CREATE (user)-[:PERFORMED_AUTH_EVENT]->(event)
         RETURN session.jti AS jti`,
        input,
      );
      return result.records.length === 1;
    });
  }

  async recordLoginFailure(email: string, eventId: string, now: string): Promise<void> {
    await this.neo4j.executeWrite(async (tx) => {
      await tx.run(
        `OPTIONAL MATCH (user:User {email: $email})
         CREATE (event:AuthActivityEvent {
           eventId: $eventId, schemaVersion: 1, eventType: 'AUTH_LOGIN_FAILED',
           timestamp: datetime($now), source: 'APPLICATION', userId: user.id
         })
         FOREACH (_ IN CASE WHEN user IS NULL THEN [] ELSE [1] END |
           CREATE (user)-[:PERFORMED_AUTH_EVENT]->(event)
         )`,
        { email, eventId, now },
      );
    });
  }
}

export class AccountConflictError extends Error {
  constructor() {
    super('Account registration conflict');
    this.name = 'AccountConflictError';
  }
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    typeof (error as Neo4jError).code === 'string' &&
    (error as Neo4jError).code.includes('ConstraintValidationFailed');
}
