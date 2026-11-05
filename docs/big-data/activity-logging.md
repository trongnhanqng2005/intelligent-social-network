# Activity Logging v1

Activity Logging is a research-only source for batch analytics and future Anomaly Detection. Capture defaults to off. The opt-in requires `NODE_ENV=test`, database `isn-test`, a loopback `NEO4J_URI`, and invocation-only `ISN_TEST_WRITE_WINDOW=owner-approved`; enabled capture with any other target fails closed. The flag is valid only for a fresh Owner-confirmed write window. User notice, production retention and access policy must be settled before any expansion to real-user environments.

## Events and consistency

| Domain | Allowed event types |
| --- | --- |
| Authentication projection | `AUTH_REGISTERED`, `AUTH_LOGIN_SUCCEEDED`, `AUTH_LOGOUT` |
| Friendship | `FRIEND_REQUEST_CREATED`, `FRIEND_REQUEST_ACCEPTED`, `FRIEND_REQUEST_REJECTED`, `FRIEND_REQUEST_CANCELLED`, `FRIENDSHIP_REMOVED` |
| Posts | `POST_CREATED`, `POST_UPDATED`, `POST_DELETED`, `POST_LIKED`, `POST_UNLIKED` |
| Comments | `COMMENT_CREATED`, `COMMENT_UPDATED`, `COMMENT_DELETED` |

V7 stores domain transitions in `ActivityEvent`. Its fields are the unique UUID `eventId`, integer `schemaVersion`, `eventType`, UTC `occurredAt`, `source`, `actorId`, optional `targetUserId`, `objectType` and `objectId`. Only applied mutations write an event in their existing transaction. A rejected operation, rollback or idempotent no-op produces no event. Driver retries use the same logical event ID. Client retry coverage follows the existing endpoint contracts.

Authentication keeps its existing operational events. The export projects the three approved types from `AuthActivityEvent`, with no social-history backfill. Failed login and session IDs stay outside the research projection. The storage and export allowlists exclude credentials, tokens, email, IP, device data and user content.

## Batch and retention

The exporter publishes one immutable JSON bundle containing `manifest` and `rows`. The manifest records schema, provenance, time window, watermark, key version, row count and checksum. Data/ML consumers can parse the `rows` array and feed it to a future batch ingestion step. Application and synthetic modes are separate. Spark ETL remains a separate workstream.

User, event and object identifiers are pseudonymized with HMAC-SHA256 in separate namespaces. The actor and target share the user namespace. Store a random key of at least 32 bytes outside the repository, using owner-only permissions or a restricted Windows ACL. Use a dedicated operator-owned snapshot directory outside the repo. Grant the Data/ML team access only to approved bundles. Pseudonyms remain linkable within one key and access scope. Matching input rows, window, creation time and key reproduce the same bundle. Later writes and erasure can change a new database read for that window.

- Research `ActivityEvent` rows and managed export snapshots expire after 30 days. Run the guarded purge at least daily in the approved research environment. The v1 tooling does not emit aggregates. Any later managed nonidentifying aggregate has a 90-day cap.
- After the account deletion process removes the User, the restricted operator erases its research events as actor or target and revokes whole matching managed snapshots. Exports exclude deleted identities. Operational authentication retention remains separate. Key mismatch blocks revocation. Keep each key version in its own controlled snapshot directory until those snapshots expire or are revoked.
- Revocation covers the managed store. Coordinate copies already delivered to an approved consumer and record the withdrawal there. Avoid uncontrolled copies.

## Operations and verification

Build the API, use the verified V7 database and load only the restricted test configuration for capture and operator tests. Follow the [Neo4j gates](../development/neo4j-operations.md) and [verification commands](../development/testing.md). Keep provisioning, migration and fixture writers behind a fresh, invocation-only Owner authorization.

## Operator commands

Provide an existing absolute, operator-controlled snapshot directory outside this repository and an absolute key file outside the repository. The Windows key ACL must be limited to the operator, SYSTEM and local administrators. Use a separate directory per key version. Runtime refuses a stale directory lock and blocks destructive work if a managed snapshot cannot be verified.

```powershell
$env:ACTIVITY_CAPTURE_ENABLED = 'true'
$env:ACTIVITY_KEY_VERSION = 'research-v1'
node --env-file=apps/api/.env.test.local apps/api/scripts/activity-operator.mjs export --from <UTC-ISO> --to <UTC-ISO> --max 10000 --key-file <absolute-key-path> --snapshot-dir <absolute-store-path>
# Only within a fresh Owner-approved exclusive maintenance window
$env:ISN_TEST_WRITE_WINDOW = 'owner-approved'
node --env-file=apps/api/.env.test.local apps/api/scripts/activity-operator.mjs purge --snapshot-dir <absolute-store-path>
node --env-file=apps/api/.env.test.local apps/api/scripts/activity-operator.mjs erase --user-id <deleted-account-uuid> --key-file <absolute-key-path> --snapshot-dir <absolute-store-path>
```

On 2026-11-05, V7 was verified and serial real-Neo4j capture, concurrency, export, purge and erasure scenarios passed on restricted `isn-test` during a fresh Owner-confirmed exclusive window. Operator evidence includes two pseudonymous export rows (including Auth, excluding session/email/content), one >30-day raw event and one snapshot purged, zero export rows after fixture-user deletion, and three matching snapshots plus one raw event erased. Operational Auth was retained until exact fixture cleanup; research retention is 30 days and operational Auth retention is separate. All test fixtures were removed and the application fingerprint restored. See [testing](../development/testing.md) and [Neo4j operations](../development/neo4j-operations.md) for run details.

No browser run or real-user data was involved, and automated scheduling is not implemented. A watermark represents the requested window end; two reads are not a point-in-time or completeness guarantee. Reproducibility is for the same input, not an arbitrary future reread. Independent code review of frozen candidate base `5b0f614` plus complete staged tree `e0c45e1e3a6c93650ee942dafa03de52221c3c64` returned **PASS**, with no confirmed blockers or required changes. This was source review only; supplied test evidence was not rerun by the reviewer. Activity export/operator unit tests passed 19/19, and the actual Windows ACL check passed. The candidate is ready for the already Owner-authorized commit, push, and PR; merge is not authorized here.
