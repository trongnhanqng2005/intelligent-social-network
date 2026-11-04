# Proposed use cases and business flows

The authenticated profile/member-discovery subset and Friendship implementation are verified as recorded below. Posts & Feed is implemented; V5 and focused real-database behavior were verified on restricted `isn-test` under separate Owner authorization, Step 5 Functional Acceptance was Owner-accepted, and Step 6 is complete. Production readiness remains separate. Recommendation, anomaly detection, likes and comments remain planned.

## User profile & discovery (implemented subset)

1. An authenticated member views and edits their display name, optional bio, and
   optional location using versioned updates.
2. An authenticated member browses/searches other members and opens a
   member-visible profile; the directory excludes the current member.

Uploaded avatars are not implemented. Friendship actions are in the separate [Friendship API contract](../api/friendships.md).

## Friendship lifecycle

1. A member sends a request to another registered member; the authenticated session supplies the sender identity.
2. Only recipient B accepts/rejects; only sender A cancels. Reverse pending requests conflict and are not automatically accepted.
3. Acceptance creates exactly one canonical mutual friendship edge. Either participant can later unfriend.
4. Reject, cancel and unfriend permit a new lifecycle with fresh identifiers.

The graph retains only the latest request lifecycle in `FriendshipPair`; it does not record a complete Activity Events history. See the feature contract for errors, privacy, pagination and concurrency.

## Friend recommendation

1. Batch model produces scored Top-K candidate pairs.
2. Candidate output is persisted with score, model version and computation time.
3. API filters self, current friends and pending invitations.
4. UI displays remaining candidates; a user may initiate a friendship request.

Candidate freshness, tie handling, consent, ranking visibility and refresh cadence are open decisions.

## Anomaly detection and review

1. Account actions generate activity events.
2. Batch aggregation computes account/time-window features.
3. Anomaly model produces a score and detected time.
4. System creates an alert; an administrator reviews and marks it reviewed.

The model is decision support only: no automatic account lock. Alert thresholds, false-positive handling and audit/retention policies are open.

## Content and interaction

### Posts & Feed (implemented; focused test-database verification complete)

1. An authenticated member creates a plain-text post, defaulting to friends-only; content is normalized and limited to 2,000 Unicode code points.
2. The owner, any authenticated member for `members` visibility, or a current accepted friend for `friends` visibility may read a post. Friendship changes affect access to existing posts.
3. The home feed contains the viewer and current accepted friends, ordered chronologically with stable keyset pagination; profile lists include only caller-visible posts.
4. The owner may edit content or permanently delete a post using `expectedVersion`; visibility cannot be changed. A visible non-owner gets 403, while an invisible/missing post gets a privacy-safe 404.

V5 and the reviewed Post grant delta were applied to restricted `isn-test` under separate Owner authorization. The focused real-Neo4j scenario and query-plan check passed with exact cleanup and baseline restoration; this is not production readiness or Step 5 Scenario Testing. See the [Posts & Feed API contract](../api/posts-feed.md). Likes, comments and proposed administrator override remain unimplemented; their policies are not inferred from the post MVP.
