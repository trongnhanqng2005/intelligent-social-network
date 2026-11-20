import type { ManagedTransaction, Transaction } from 'neo4j-driver';
import { PasswordService } from '../modules/auth/password.service.js';
import { DEMO_MEMBERS, LEGACY_EMAILS, SocialDemoRefusal } from './accounts.js';
import { readManifest } from './manifest.js';

export async function inspectLegacy(
  tx: ManagedTransaction | Transaction, databaseId: string, expectedComments: number,
): Promise<Array<{ id: string; email: string; hash: string }>> {
  const manifest = await readManifest('isn-dev', databaseId);
  const ids = manifest?.users.map(({ id }) => id) ?? [];
  const roster = await tx.run(
    `MATCH (u:User) WHERE u.email IN $emails OR u.id IN $ids
     RETURN u.id AS id, u.email AS email, u.passwordHash AS hash,
            coalesce(u.role, 'USER') AS role, u.socialDemoVersion AS version, u.displayName AS displayName`,
    { ids, emails: LEGACY_EMAILS },
  );
  const legacy = roster.records.filter(row => LEGACY_EMAILS.includes(row.get('email')));
  if (!legacy.length) {
    if (roster.records.length && (!manifest || roster.records.length !== DEMO_MEMBERS.length ||
        !manifest.users.every(({ id }, index) => roster.records.some(row => row.get('id') === id &&
          row.get('email') === DEMO_MEMBERS[index]!.email && Number(row.get('version')) === 2)))) {
      throw new SocialDemoRefusal('Legacy manifest IDs match an unexpected roster.');
    }
    return [];
  }
  if (!manifest || legacy.length !== LEGACY_EMAILS.length || roster.records.length !== legacy.length) {
    throw new SocialDemoRefusal('Legacy demo roster does not match the private owner manifest.');
  }

  const passwords = new PasswordService();
  const owners = [];
  for (const [index, user] of manifest.users.entries()) {
    const row = legacy.find(record => record.get('id') === user.id && record.get('email') === user.email);
    const hash = row?.get('hash');
    if (!row || row.get('role') !== 'USER' || row.get('version') !== null || row.get('displayName') !== DEMO_MEMBERS[index]!.displayName ||
        typeof hash !== 'string' || !await passwords.verify(hash, user.password)) {
      throw new SocialDemoRefusal('Legacy demo account ownership could not be verified.');
    }
    owners.push({ id: user.id, email: user.email, hash });
  }

  // Check the fixture boundary before changing any identity. Auth sessions and audit
  // events are retained. Every other adjacent relationship must stay within the fixture.
  const graph = await tx.run(
    `MATCH (u:User) WHERE u.id IN $ids
     WITH collect(u) AS users
     OPTIONAL MATCH (u:User)-[:AUTHORED]->(p:Post) WHERE u IN users
     WITH users, collect(DISTINCT p) AS posts
     OPTIONAL MATCH (u:User)-[:WROTE_COMMENT]->(c:Comment) WHERE u IN users
     WITH users, posts, collect(DISTINCT c) AS comments
     RETURN size(posts) = 27 AND size(comments) = $expectedComments
       AND COUNT { MATCH (p:FriendshipPair)
         WHERE p.lowUserId IN $ids AND p.highUserId IN $ids AND p.requestStatus = 'ACCEPTED' } = 18
       AND COUNT { MATCH (p:FriendshipPair)
         WHERE p.lowUserId IN $ids AND p.highUserId IN $ids AND p.requestStatus = 'PENDING' } = 5
       AND NOT EXISTS { MATCH (p:FriendshipPair)
         WHERE (p.lowUserId IN $ids OR p.highUserId IN $ids OR p.senderId IN $ids OR p.recipientId IN $ids)
           AND NOT coalesce(p.lowUserId IN $ids AND p.highUserId IN $ids
             AND p.senderId IN $ids AND p.recipientId IN $ids
             AND p.requestStatus IN ['ACCEPTED', 'PENDING'], false) }
       AND COUNT { MATCH (u:User)-[:FRIEND_WITH]->(v:User) WHERE u IN users AND v IN users } = 18
       AND COUNT { MATCH (u:User)-[:LIKED]->(p:Post) WHERE u IN users AND p IN posts } = 75
       AND COUNT { MATCH (c:Comment)-[:ON_POST]->(p:Post) WHERE c IN comments AND p IN posts } = $expectedComments
       AND NOT EXISTS { MATCH (a)-[r]->(b)
         WHERE (a IN users + posts + comments OR b IN users + posts + comments)
           AND NOT (
             (a IN users AND ((type(r) = 'FRIEND_WITH' AND b IN users)
               OR (type(r) IN ['AUTHORED', 'LIKED'] AND b IN posts)
               OR (type(r) = 'WROTE_COMMENT' AND b IN comments)
               OR (type(r) = 'HAS_AUTH_SESSION' AND b:AuthSession)
               OR (type(r) = 'PERFORMED_AUTH_EVENT' AND b:AuthActivityEvent)))
             OR (a IN comments AND type(r) = 'ON_POST' AND b IN posts)
           ) } AS verified`,
    { ids, expectedComments },
  );
  if (graph.records[0]?.get('verified') !== true) {
    throw new SocialDemoRefusal('Legacy graph differs from the fixture or contains links outside it.');
  }
  return owners;
}
