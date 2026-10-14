# User Profile & Discovery Scenario Testing

**Executed:** 2026-10-14
**Branch:** `feature/user-profile-discovery`
**Result:** PASS, with the Owner-approved historical V3 backfill exception below.

This is Step 5 acceptance evidence for the real React → NestJS → restricted Neo4j `isn-test` stack. It complements rather than replaces the app-local unit/HTTP tests and Build-time smoke checks.

## Approved exception and safety boundary

- No legacy users existed when V3 was applied. Per the approved amendment, no pre-V3 users were recreated and no historical nonempty backfill was tested or claimed. Acceptance instead verified V3 readiness, transactional profile defaults on new registration, stable Authentication identity, version initialization and non-mutating profile reads.
- All database acceptance writes used `isn-test` as `isn_test_runner`, with exactly `PUBLIC` and `isn_test_runner_role`; the identity was explicitly denied access to `isn-dev`. A read-only grant-catalog comparison confirmed all 58 effective grants match the approved manifest.
- The final read-only preflight reported V1–V3 `VERIFIED`, schema marker 3, all 7 expected constraints, all 10 application indexes (excluding Neo4j lookup indexes), and the V3 `User.displayNameSearch` TEXT index `ONLINE`. `/ready` returned `{"status":"ready","database":"isn-test","schemaVersion":3}`. No provisioning or migration command was run for acceptance.
- Pre- and post-run counts were 0 users, 0 sessions and 2 pre-existing auth events. The MCP-owned journey temporarily created one synthetic account, one session and three linked events; UUID-bound cleanup removed exactly those records and restored the baseline. The dedicated browser suite and auth regression suite also verified their owned-fixture cleanup.
- Browser/API tests used dedicated loopback ports and refused to reuse existing services. The separately launched MCP runtime used ports 3306/5176, created invocation-owned ephemeral signing keys, and stopped only its recorded process trees. No password, token, screenshot or trace was retained in acceptance evidence.

## Scenario results

| ID | Result | Evidence |
|---|---|---|
| UPD-00 | PASS | `npm run test:neo4j:profile-preflight`; exact database/principal/roles, `isn-dev` denial, checksums/history, marker, schema catalog, profile invariants and baseline verified read-only. Profile E2E also verified `/ready` and Vite proxy readiness before fixture writes. |
| UPD-01 | PASS* | Real UI registration and login retained the same `User.id`; default display name, null optional fields, version 0, profile timestamps and Authentication hash/event were checked. Repeated own-profile GETs left profile/auth snapshots unchanged; registration did not create a session before login. |
| UPD-02 | PASS | Real React/API/Neo4j save, reload, cancel, optional-field clearing and version behavior passed in the dedicated profile browser and real profile integration. |
| UPD-03 | PASS | Real HTTP/browser checks covered anonymous denial, principal-owned updates, rejected arbitrary/private fields, Origin/CSRF, no-store and exact own/public projections without Authentication/search/internal leakage. |
| UPD-04 | PASS | Real Neo4j directory/search and browser navigation covered self-exclusion, Vietnamese accent/case folding (including `đ`), no-match, email/bio/location-only non-searchability, public projection and return navigation. |
| UPD-05 | PASS | Real integration covered default/max limits, UUID keyset traversal, `hasMore`/cursor, query mismatch and stable-data pagination; browser acceptance verified the user-visible search/page flow. |
| UPD-06 | PASS | Real simultaneous Neo4j PATCHes at version N yielded exactly one 200 and one 409 `PROFILE_CONFLICT`, final version N+1 and winner-only fields. Browser conflict recovery retained the stale draft until explicit reload and a separate save action. |
| UPD-07 | PASS | Controlled profile/API failures and stale discovery responses were explicitly simulated by narrow browser interception; interception was removed before real recovery. Session-unavailable recovery and duplicate-submit behavior passed. No real backend outage is claimed. |
| UPD-08 | PASS | Real Chromium acceptance passed at 1440×900, 768×1024, 390×844 and 320×740, including overflow, member navigation, keyboard skip-link focus, accessible error focus and reduced motion. |
| AUTH-REG | PASS | `npm run test:e2e:auth`: 10/10 on desktop/mobile against restricted real `isn-test`. `npm run test:e2e`: 14/14 foundation tests against explicit dummy Neo4j settings; this is browser-regression evidence, not database evidence. Assertions were not skipped or weakened. |

\* UPD-01 excludes only historical nonempty V3 backfill verification under the explicit Owner-approved exception.

## Executed commands and limits

Passed:

```text
npm run test:neo4j:profile-preflight
npm run build:api
node --env-file=apps/api/.env.test.local --test tests/integration/neo4j/users.test.mjs
node --env-file=apps/api/.env.test.local --test tests/integration/neo4j/auth.test.mjs
npm run test:e2e:profile
npm run test:e2e:auth
npm run test:e2e
npm test
npm run test:api:e2e
npm run test:integration
npm run typecheck
npm run build
git diff --check
```

Final totals: API/Web app-local tests 89/89 and 44/44; API HTTP tests 9/9; root HTTP proxy integration 1/1; typecheck and workspace build passed. The first root integration attempt found an unrelated listener on port 5173 and did not terminate it. The proxy test was updated to allocate a free Vite port as well as its ephemeral API port, then passed; the pre-existing listener was left untouched.

The focused real Neo4j profile and authentication tests passed. The full `npm run test:neo4j` command was deliberately not run: `tests/integration/neo4j/schema.test.mjs` calls `migrations.migrate()` twice against its configured database. The migration-runner/idempotency assertions remain intact; no migration-writing test was run on the live acceptance database.

The separate Playwright MCP journey used a pre-registration ownership manifest, independently verified `/ready`, then completed UI registration → login → reload restoration → profile view → self-excluding discovery → logout/protected redirect. Read-only database checks bound the manifest to the created UUID before cleanup. The expected anonymous `/api/auth/session` 401 was not treated as a product failure.

Final regression, typecheck/build, cleanup, artifact-sanitization and `git diff --check` results are recorded in [`task/user-profile-discovery/todo.md`](../../task/user-profile-discovery/todo.md). No independent code review or Git publication was started.
