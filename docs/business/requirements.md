# Business requirements (planned)

**Source:** Project proposal `D:/DoAn/BigData/docs/De_cuong_du_kien_trien_khai_Mang_xa_hoi_Big_Data.docx`, sections 2–5. It labels itself a prospective outline; it has no detailed API specifications, shipped code, or measured ML results. The following are approved targets, not implemented functionality.

## Actors

- **User:** account, profile, posts, interactions, friendship requests, and recommendations.
- **Administrator:** view statistics and anomaly alerts; mark alerts reviewed.
- **Data/ML process:** ingest activity/datasets, create features, train/score models, publish outputs.

## Proposed capability areas

| Area | Intended capability | Current status |
|---|---|---|
| Authentication (AUTH) | Register, sign in/out, validate session/JWT | Email/password registration, login, 24-hour Neo4j-backed browser session, CSRF defense and logout/revocation implemented; account recovery remains unimplemented |
| User profile & discovery (USER) | View/edit display name and bio; browse/search members and view member-visible profiles | Authenticated display name, optional bio/location, privacy-safe member projection, and bounded directory/search implemented. Avatar upload is not implemented; UI uses local initials. |
| Posts (POST) | Create/edit/delete/read posts and a simple feed | Implemented; V5 and focused real-Neo4j behavior verified on restricted `isn-test`; broader Scenario Testing remains separate |
| Interaction (INT) | Like/unlike and comment on posts | Not implemented |
| Friendships (FRIEND) | Send/list/accept/reject/cancel requests; list/unfriend friends; view caller-relative profile relationship | Implemented; corrected Step 6 real-Neo4j concurrency and browser acceptance passed, and restricted `isn-test` V4/baseline were freshly verified |
| Recommendations (REC) | Show Top-K candidates and allow request initiation | Not implemented |
| Activity (EVENT) | Record events such as logins, requests, posts and comments | Authentication events are recorded transactionally; other event families are not implemented and retention remains undecided |
| Administration (ADMIN) | View aggregate statistics/alerts and mark reviewed | Not implemented |
| Data processing (PIPE) | Ingest, clean, aggregate features, update batch predictions | Not implemented |

Implemented source HTTP contracts include process liveness/readiness, Authentication, User Profile & Discovery, Friendship, and Posts & Feed. Focused Posts V5 and real-Neo4j behavior are verified on restricted `isn-test`; this does not establish `isn-dev` or production readiness. See [Posts & Feed](../api/posts-feed.md), [API integration](../architecture/integration.md) and the [API contract index](../api/README.md). Interactions and other proposal capabilities remain planned.

## Core proposal rules

- Friendship rules: no self-friendship; one pending request or accepted relationship per unordered pair; duplicate same-direction and reverse pending requests conflict without auto-accept; re-request is allowed after reject/cancel/unfriend. See the [Friendship API contract](../api/friendships.md).
- Only a post/comment owner or an administrator under an eventual authorization policy may edit/delete that content.
- Recommendations and anomaly detections are probabilistic/derived data, not definitive relationship or misconduct evidence.
- Anomaly review should not automatically lock an account; an administrator reviews an alert.
- The proposal distinguishes simulated events from application-generated activity. Event records must not contain passwords or tokens; minimize sensitive identifying information.

Posts/feed authorization, moderation and visibility are specified for the MVP in the [Posts & Feed contract](../api/posts-feed.md). Admin override, interaction behavior, account lifecycle and production deployment remain undecided. Friendship's approved authorization, transition, privacy, and graph rules are documented in its feature contract; latest lifecycle state is not a complete Activity Events history.
