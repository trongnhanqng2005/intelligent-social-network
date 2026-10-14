# Proposed use cases and business flows

The authenticated profile/member-discovery subset is implemented; see the [User Profile & Discovery API](../api/user-profile-discovery.md). Friendship implementation, corrected Step 6 real-Neo4j concurrency tests and real-stack acceptance passed against restricted `isn-test`, with the original data baseline restored. Recommendation, anomaly, content and interaction remain planned.

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

Users are expected to create and view posts, edit/delete their own posts, like/unlike and comment. Admin override is proposed for content changes, but authorization boundaries and visibility/moderation rules are not specified.
