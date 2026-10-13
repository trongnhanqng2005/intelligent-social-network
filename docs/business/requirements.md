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
| User profile (USER) | View/edit display name, avatar and bio | Not implemented |
| Posts (POST) | Create/edit/delete/read posts and a simple feed | Not implemented |
| Interaction (INT) | Like/unlike and comment on posts | Not implemented |
| Friendships (FRIEND) | Send/cancel/accept/reject requests; list friends | Not implemented |
| Recommendations (REC) | Show Top-K candidates and allow request initiation | Not implemented |
| Activity (EVENT) | Record events such as logins, requests, posts and comments | Authentication events are recorded transactionally; other event families are not implemented and retention remains undecided |
| Administration (ADMIN) | View aggregate statistics/alerts and mark reviewed | Not implemented |
| Data processing (PIPE) | Ingest, clean, aggregate features, update batch predictions | Not implemented |

Implemented HTTP contracts include process liveness/readiness and the authentication foundation; see [API integration](../architecture/integration.md) and the [API contract index](../api/README.md). Other proposal capabilities remain planned.

## Core proposal rules

- A user cannot friend themselves, create a duplicate pending request, or recreate an existing friendship.
- Only a post/comment owner or an administrator under an eventual authorization policy may edit/delete that content.
- Recommendations and anomaly detections are probabilistic/derived data, not definitive relationship or misconduct evidence.
- Anomaly review should not automatically lock an account; an administrator reviews an alert.
- The proposal distinguishes simulated events from application-generated activity. Event records must not contain passwords or tokens; minimize sensitive identifying information.

Authorization details, moderation policy, deletion/retention behavior, request conflict resolution, and account lifecycle remain unspecified and must be decided with the corresponding feature plan.
