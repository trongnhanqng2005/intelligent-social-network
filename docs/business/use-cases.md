# Proposed use cases and business flows

Friendship, recommendation, anomaly, content and interaction flows below are
proposal-derived and unimplemented. The basic authenticated profile and member
discovery subset is implemented; see the [User Profile & Discovery API](../api/user-profile-discovery.md).

## User profile & discovery (implemented subset)

1. An authenticated member views and edits their display name, optional bio, and
   optional location using versioned updates.
2. An authenticated member browses/searches other members and opens a
   member-visible profile; the directory excludes the current member.

Uploaded avatars and social-graph actions are not part of this implementation.

## Friendship lifecycle

1. User A requests friendship with B.
2. System validates eligibility and records a pending directed request.
3. B accepts or rejects; either user may cancel according to a policy still to be specified.
4. Acceptance creates one logical mutual friendship and records a corresponding activity event.

Required invariants in the proposal: no self-friendship, duplicate pending request, or duplicate existing friendship.

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
