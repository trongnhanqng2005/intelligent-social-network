# Proposed use cases and business flows

All flows below are proposal-derived and unimplemented. They are domain scenarios, not current API routes.

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
