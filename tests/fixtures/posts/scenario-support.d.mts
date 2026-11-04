import type { BrowserContext } from '@playwright/test';
import type { Driver, Session } from 'neo4j-driver';

export interface ScenarioUser {
  id: string;
  email: string;
  password: string;
  registrationEventId: string;
}

export interface ScenarioManifest {
  baseline: { dataFingerprint: string };
  fixtures: {
    friendships: Array<{
      friendshipIds: string[];
      requestStatus: string;
      friendshipId: string | null;
      lowUserId: string;
      highUserId: string;
    }>;
  };
}

export interface PostsScenario {
  driver: Driver;
  session: Session;
  manifestPath: string;
  manifest: ScenarioManifest;
  users: ScenarioUser[];
  contexts: BrowserContext[];
  appModule: { get<T = any>(token: unknown): T; close(): Promise<void> };
}

export function createPostsScenario(options?: { actorCount?: number }): Promise<PostsScenario>;
export function recordScenarioAuthState(scenario: PostsScenario, userId: string): Promise<boolean>;
export function recordScenarioContext(scenario: PostsScenario, context: BrowserContext): Promise<void>;
export function reserveScenarioFriendship(scenario: PostsScenario, input: {
  senderId: string;
  recipientId: string;
  requestedAt?: string;
}): Promise<string>;
export function recordScenarioFriendshipCreated(
  scenario: PostsScenario,
  intentId: string,
  requestId: string,
  requestedAt?: string,
): Promise<void>;
export function recordScenarioFriendshipResolved(scenario: PostsScenario, intentId: string, result: {
  requestStatus: 'ACCEPTED' | 'REJECTED' | 'CANCELLED';
  friendshipId?: string | null;
  friendsSince?: string | null;
  resolvedAt: string;
}): Promise<void>;
export function reserveScenarioPost(scenario: PostsScenario, input: {
  authorId: string;
  marker: string;
  visibility: 'friends' | 'members';
}): Promise<void>;
export function recordScenarioPost(scenario: PostsScenario, input: {
  authorId: string;
  marker: string;
  postId: string;
}): Promise<void>;
export function cleanupPostsScenario(scenario: PostsScenario): Promise<void>;
