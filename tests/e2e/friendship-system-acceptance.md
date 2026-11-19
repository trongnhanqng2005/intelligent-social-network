# Friendship System — Scenario Acceptance Record

**Date:** 2026-10-14

**Worktree/branch:** `isn-worktrees/friendship-system` / `feature/friendship-system`

**Scenario plan:** Owner-approved FS-00–FS-10 plan with the Adviser amendments

**Status:** Step 5 acceptance was recorded as passed before review corrections. Resumed Step 6 final verification passed the corrected real Neo4j suite, real-stack browser acceptance, and final read-only preservation gate; the current evidence is recorded in this acceptance matrix and the [Neo4j operations record](../../docs/development/neo4j-operations.md).

## Safety gate and preserved baseline

The final read-only `npm run test:neo4j:friendship-acceptance-preflight` passed before the browser run and after the real Neo4j regression suite. It verified:

- Target `isn-test`, database ID `336953E435C22F87EF53AAF1A42024422029E9ECB305B7108694A6EEDC37A786`.
- Restricted principal `isn_test_runner`, roles `PUBLIC` and `isn_test_runner_role`; 80 approved role privileges plus 4 inherited PUBLIC privileges. Access to `isn-dev` was denied.
- V1–V4 migration history/checksums, 11 constraints, 16 ONLINE indexes and valid graph invariants.
- Baseline before/after: **0 users, 0 sessions, 2 preserved auth events, 0 `FriendshipPair` records, 0 `FRIEND_WITH` edges**.
- Preservation fingerprint unchanged: `d5ddea94c6c1f7cb024803515c948838d63f47479576ee6ce9cd69ea4ad66437`.
- Dedicated browser ports 3311/5181 available; no unknown ownership manifests or active `isn-test` transactions.

No application data was read from `isn-dev`; no migration was applied during scenario execution; no database was reset.

## Scenario results

| Scenario | Evidence and outcome |
| --- | --- |
| **FS-00 — Safety/current-V4 gate** | Read-only identity, least-privilege, V1–V4 catalog, schema, graph, baseline, port and fixture-manifest checks passed. |
| **FS-01 — Send request** | Alice discovered Bob in the real UI, sent the request through Vite/API, and saw the outgoing state survive reload. Bob’s incoming list showed the same request; the graph contained one pending canonical pair and no friendship edge. |
| **FS-02 — Accept** | Bob accepted through the UI. Both members’ friends lists survived reload; graph checks matched the API friendship ID, canonical pair key, low-to-high endpoints and timestamp. |
| **FS-03 — Reject/cancel/retry** | Real UI rejection and cancellation produced no edge. Repeating the same terminal action was idempotent; contradictory actions conflicted; a later request received a new ID and could be accepted. Real API races also covered accept/cancel and accept/reject. |
| **FS-04 — Unfriend/re-request** | The confirmation could be cancelled without issuing DELETE and restored keyboard focus. Confirmed unfriend returned 204, removed the edge from both views, and a later accepted request used a different request and friendship ID. |
| **FS-05 — Concurrency/invariants** | The resumed Step 6 real-Neo4j suite passed 1/1 after adding test-local barriers: two distinct managed write callbacks overlapped for same-direction and opposite-direction requests, duplicate acceptance, accept/cancel, accept/reject and concurrent unfriend. Race outcomes, rollback, stale IDs and graph-wide invariants passed. Callback overlap and transaction outcomes/commits are asserted separately. |
| **FS-06 — Privacy/security** | Anonymous access returned 401/no-store; a nonparticipant could not inspect a request (404) and a nonparticipant DELETE was harmless (204). Public DTO fields excluded private/internal data. Invalid Origin and other middleware/DTO failure cases were checked without lifecycle changes. |
| **FS-07 — Pagination** | Real API-issued cursors drove friends, received-request and sent-request UI next/previous pages. Integration checks covered defaults, limits, malformed, cross-viewer and cross-direction cursors. |
| **FS-08 — Recovery/error states** | Covered a client request held in the browser before it is forwarded, a real committed 201 whose browser response was suppressed, an explicitly **simulated** HTTP 503, a real stale 409 and a delayed real status read after SPA navigation. UI retry/reconciliation reflected graph state; the stale response did not overwrite the next profile. Simulated faults are not reported as backend failures. |
| **FS-09 — UI/accessibility** | The resumed real-stack browser acceptance passed 1/1 and exercised browser history, reduced-motion computed scroll behavior, keyboard `:focus-visible`, focus/restore for confirmation, a 44px action target and no horizontal overflow at 320/390/768/1440px. |
| **FS-10 — Ownership/cleanup** | Run/account/pair/request/friendship ownership was recorded before mutations. Exact run-owned graph and account records were removed; final read-only fingerprint and counts matched the original baseline. No fixture manifests or active test transactions remained. |

## Recorded Step 5 verification (historical)

- `npm run test:e2e:friendships` — **1 Playwright test passed**, Chromium, one worker, zero retries; full real UI → Vite proxy → NestJS → restricted Neo4j path, reloads and graph checks.
- `npm run test:neo4j` — **5/5 serial real-database tests passed**, including authentication, Friendship lifecycle/concurrency/rollback, read-only profile readiness, V1–V4 migration catalog/idempotency, and profile concurrency. `isn-dev` remained denied to the test identity.
- `npm run test:neo4j:profile-preflight` — passed; `npm run test:e2e:profile` — **1/1** UPD-01–08 real-stack regression passed and cleaned its fixtures.
- `npm test` — API **20 suites / 118 tests** and Web **12 files / 57 tests** passed.
- `npm run test:api:e2e` — **2 suites / 11 tests** passed; `npm run test:integration` — **1 test** passed; `npm run test:e2e` — **14** desktop/mobile Chromium tests passed.
- `npm run typecheck` and `npm run build` — passed.
- OpenAPI validation — YAML parsed; **17 paths, 19 operations, 162 references, 0 unresolved local references**, unique operation IDs.
- Final `git diff --check` — passed.

The listed Step 5 commands are historical. After Neo4j was started, Step 6 reran the corrected focused Neo4j suite and browser acceptance; both passed. Repeated read-only pre/post gates confirmed the database identity, privileges, V1–V4 schema, zero owned fixtures/transactions, original baseline and unchanged preservation fingerprint. The [Neo4j operations record](../../docs/development/neo4j-operations.md) documents the scope and current baseline evidence.

## Gate interpretation and recovery note

The legacy read-only V1–V3 pre-V4 deployment gate remains unchanged. A read-only attempt against the already-V4 target correctly rejected the V4 history row; it is not a current-V4 acceptance gate. The separate FS-00 current-V4 gate passed, and the full current-V4 suite retained and passed migration-idempotency assertions.

An early browser attempt stopped when cleanup found a session count not yet reflected in its retained manifest. The manifest was preserved; read-only reconciliation scoped to that run proved its owned records absent and the original fingerprint restored. Cleanup then resumed using only that exact manifest. Subsequent Step 5 and resumed Step 6 runs cleaned normally. The final Step 6 gate confirmed no unresolved manifests and the original baseline/fingerprint.

The independent Step 6 review passed before publication; this file records the technical acceptance evidence and does not make a claim about PR or merge state.
