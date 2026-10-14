# Testing strategy

## Test ownership

- **App-local tests (existing):** Nest Jest unit tests and Supertest API E2E remain under `apps/api`; React Vitest/RTL tests remain beside source under `apps/web/src`. Keep framework-specific behavior, component rendering and API-internal HTTP contract tests there. Do not migrate/duplicate them.
- **Root integration:** `tests/integration/api-proxy.test.mjs` launches the API and Vite dev server, calls `/api/health`, and verifies the forwarded HTTP/JSON response without a browser. The Weylume homepage no longer calls or displays health status; this infrastructure proxy contract is independent of the UI.
- **Root browser E2E:** Playwright Test scenarios live only in `tests/e2e/specs/`. The current foundation suite exercises real Chromium desktop and emulated mobile browsers against Playwright-managed API and Vite dev servers. It complements, rather than copies, app-local tests.
- **Weylume Scenario Testing (2026-10-14):** the approved Step 5 acceptance has adapted `foundation.spec.ts` to current homepage/navigation/not-found behavior while retaining the API proxy health check independently; `authentication.spec.ts` uses the current confirmation form, welcome/loading states, and accessible locators. See the WY-00–WY-12 evidence in [authentication acceptance](../../tests/e2e/authentication-acceptance.md). This run is distinct from the earlier redesign Build screenshots and did not reopen visual design.
- **Root unit:** `tests/unit/api-e2e-key-ownership.test.mjs` checks invocation-owned ephemeral-key cleanup, including concurrent invocation isolation and rejection of a mismatched ownership marker.
- Follow [tests/README.md](../../tests/README.md) for category ownership, browser locators, mock boundaries, data isolation, artifacts and feature-plan references.

## Commands

| Command | Includes |
|---|---|
| `npm test` | API Jest unit and Web Vitest/RTL app-local suites |
| `npm run test:api:e2e` | API-local Supertest endpoint test |
| `node --test tests/unit/api-e2e-key-ownership.test.mjs` | Standalone ephemeral-key ownership regression (not included in `npm test`) |
| `npm run test:integration` | Root Node.js API-through-Vite HTTP integration scenario |
| `npm run test:neo4j` | Explicit real-DB integration against `isn-test` (requires dedicated test credentials and schema privileges) |
| `npm run test:neo4j:profile-preflight` | Read-only restricted `isn-test` UPD-00 identity/schema/data gate; no writes |
| `npm run test:neo4j:friendship-acceptance-preflight` | Read-only restricted `isn-test` current-V4 FS-00 identity/schema/data/ownership gate; no writes |
| `npm run test:neo4j:friendships` | Rechecks FS-00, builds API, then runs the focused real-Neo4j Friendship writer; requires the exclusive approved test-database write window |
| `npm run test:e2e` | Headless Playwright foundation suite against explicit dummy Neo4j settings |
| `npm run test:e2e:auth` | Separate desktop/mobile browser auth journeys against restricted real `isn-test` and current V4 readiness |
| `npm run test:e2e:profile` | Real-stack desktop Chromium profile/discovery acceptance against restricted `isn-test` |
| `npm run test:e2e:friendships` | Rechecks FS-00, then runs one-worker real-stack Friendship browser acceptance on ports 3311/5181; creates and cleans exact owned test fixtures |
| `node --test tests/unit/friendship-acceptance-support.test.cjs` | Unit regression that preservation manifests store hashes/counts, not raw auth/profile records |
| `npm run test:e2e:headed` | Run Playwright with a visible browser |
| `npm run test:e2e:ui` | Open Playwright UI mode |
| `npm run test:e2e:report` | Open the latest generated HTML report |
| `npm run test:root:e2e` | Alias for the Playwright browser suite |
| `npm run test:root` | Root integration scenario followed by browser QA |
| `npm run typecheck` | API and Web typechecks |
| `npm run build` | API and Web production builds |

The integration check uses Node 24's built-in [`node:test` runner](https://nodejs.org/docs/latest-v24.x/api/test.html). Browser QA uses pinned [`@playwright/test` 1.64.0](https://playwright.dev/docs/intro) and its matching Chromium build. Install that browser once with `npx playwright install chromium`. The foundation Playwright servers use strict ports 3301/5174; real-auth uses 3302/5175; profile uses 3305/5178; Friendship uses 3311/5181. Each refuses to reuse unrelated servers. Foundation browser/API contract tests set a non-routable dummy Neo4j endpoint and do not prove DB access. `test:neo4j:friendship-preflight` is the preserved read-only V1–V3 deployment gate before migration; do not substitute it for the post-V4 `test:neo4j:friendship-acceptance-preflight` current-schema FS-00 gate. The Friendship writer and browser acceptance require `NODE_ENV=test`, `NEO4J_DATABASE=isn-test`, no development credentials, the dedicated identity, denied `isn-dev` access, clean exact-ownership manifests and an exclusive write window. Real fixture cleanup is limited to exact synthetic identities/records; no target resets or broad graph cleanup. See [Neo4j operations](neo4j-operations.md).

The foundation browser config runs desktop Chromium and iPhone 13 mobile emulation on ports 3301/5174 with dummy Neo4j settings. Authentication browser QA uses a separate config on ports 3302/5175; it requires ignored `apps/api/.env.test.local`, verifies restricted identity/roles, V4 readiness and denied `isn-dev` access, uses ephemeral signing keys, and cleans only owned synthetic records. Auth screenshots and traces are disabled because inputs and requests can contain secrets; sanitized reports stay under ignored `.artifacts/playwright/`. Friendship's Step 5 saved browser run and interactive UI inspection are recorded in the Friendship acceptance/task records; this review did not execute a new browser run.

The profile browser config uses dedicated ports 3305/5178 and requires the same restricted real-DB safety gates as the auth browser config. It owns synthetic profile fixtures with durable, UUID-bound manifests and disables screenshots/traces. Its separate `npm run test:neo4j:profile-preflight` command is read-only; unlike the full `npm run test:neo4j` suite, it never invokes migration code. Friendship browser config uses ports 3311/5181, one worker and zero retries; its V4 preflight is read-only and its test owns UUID-bound user/pair/request/friendship fixtures with recovery manifests. See the [profile/discovery acceptance record](../../tests/e2e/user-profile-discovery-acceptance.md) and [Friendship acceptance record](../../tests/e2e/friendship-system-acceptance.md) for recorded scenario evidence and limitations.

The API HTTP suite allocates one ephemeral key directory per Jest invocation in
ignored `apps/api/.artifacts`. Global teardown resolves that directory under the
allowlisted root and verifies its invocation marker before deleting only its own
keys. It never sweeps other runs' directories. The saved real-auth journeys also
check login/logout broadcasts to a second, unfocused page and registration/login
with 100 supplementary Unicode characters (200 UTF-16 code units).

## Verification record

For the Playwright QA build: `npm run test:root` passed (1 root HTTP integration test + 12 browser tests across desktop/mobile Chromium); the final `npm run test:e2e` passed (12/12); `npm test` passed (18 API unit tests + 30 Web tests); `npm run test:api:e2e` passed (1 test); `npm run typecheck` and `npm run build` passed. A temporary, uncommitted failing smoke scenario confirmed screenshots and traces are captured; it was removed, and the final report was regenerated by the passing suite. The expected Nest Jest Node VM-modules experimental warning remains. Rerun relevant commands after future code changes.

For the authentication increment on 2026-10-13: V1 checksum remained unchanged and cumulative V2 was verified on `isn-test`; scoped token setup resolved Neo4j's nonexistent-token privilege activation behavior. The real `npm run test:neo4j` and `npm run test:e2e:auth` passed using synthetic owned fixtures, including duplicate races, transaction rollback, 24-hour session restoration/revocation/replay denial, browser reload, expired session handling, and denied `isn-dev` access. `npm test` passed (66 API tests + 32 Web tests), `npm run test:api:e2e` passed (6), `npm run test:integration` passed (1), and foundation `npm run test:e2e` passed (12). The MCP visual loop found and corrected SVG circles defaulting to black fill; desktop, tablet and mobile views and password visibility were rechecked. The dependency-only `npm audit --omit=dev` reported 0 vulnerabilities. Final typecheck/build/full audit and OpenAPI parsing are recorded in the task handoff. Dummy-endpoint tests are not database evidence.

For the User Profile & Discovery Build (2026-10-14): cumulative V3 was verified on both approved databases without changing V1/V2 checksums; the named profile TEXT index is ONLINE and repeat migration runs are no-ops. Real `isn-test` integration verifies registration defaults, privacy-safe profile projections, accent-insensitive search, UUID cursor traversal, preserved auth fields, and a two-request expected-version race with exactly one success and one conflict. API HTTP/React tests also cover CSRF, JSON-only PATCH, DTO validation, conflicts, route protection, edit state and stale search responses. Build checks do not constitute the separate Scenario Testing phase; record its approval and results only in its own task.

## User Profile & Discovery Scenario Testing (2026-10-14)

- `npm run test:neo4j:profile-preflight` passed read-only UPD-00 against restricted `isn-test`: exact identity/roles, V1–V3 checksums/status, marker/catalog/index readiness, valid profile invariants, denied `isn-dev`, and the `0/0/2` users/sessions/auth-events baseline. It performs no writes.
- Focused real Neo4j `users.test.mjs` and `auth.test.mjs` both passed after `npm run build:api`. `npm run test:e2e:profile` passed UPD-01–08 on React → NestJS → Neo4j at 1440×900, 768×1024, 390×844 and 320×740. `npm run test:e2e:auth` passed 10/10 on restricted real `isn-test`; `npm run test:e2e` passed 14/14 against dummy Neo4j and is browser regression evidence only.
- A separate, preflighted Playwright MCP journey completed UI registration/login/reload/profile/discovery/logout. UUID-bound fixture cleanup removed exactly one user, one session and three linked events, restoring the unrelated baseline `0/0/2`; invocation-owned runtime processes and signing keys were stopped/removed. The anonymous-session 401 was expected. Controlled 503/stale-response scenarios are simulated and do not claim an actual backend outage.
- Historical nonempty V3 backfill remains explicitly untested under the Owner-approved exception; no legacy state was recreated. `npm run test:neo4j` was not run because its preserved `schema.test.mjs` scenario calls `migrations.migrate()` twice against the configured database. See the [full acceptance matrix](../../tests/e2e/user-profile-discovery-acceptance.md); final regression/build/cleanup evidence is in the feature task handoff.

For future scenarios: unit tests should isolate one owned rule; integration tests should cross a real component boundary and use real services where repeatable/available (otherwise document boundary doubles); E2E tests should exercise a critical user/system flow against running components. Avoid calling an in-memory mock an integration test. Plan tests for privacy, deterministic fixtures, cleanup, and network/resource requirements before writing them.

## Weylume Scenario Testing acceptance record (2026-10-14)

- `npm run test:e2e -- foundation.spec.ts` — **12/12 passed** across desktop and mobile Chromium. Coverage includes independent Vite `/api/health` forwarding, anonymous Weylume home without a homepage health request/card, header/footer/section navigation, CTAs and redesigned not-found, controlled simulated session 503 and malformed-response states, no overflow at 1440×900, 768×1024, 390×844 and 320×740, skip-link focus, and reduced motion.
- `npm run test:e2e:auth` — **10/10 passed** across desktop and mobile Chromium on React → NestJS → restricted Neo4j `isn-test`. Preflight verified `NODE_ENV=test`, dedicated `isn_test_runner` with `PUBLIC` and `isn_test_runner_role`, schema V3 readiness, and explicit `isn-dev` denial before writes. The suite stayed within five valid registration requests per API process/hour: four successful accounts and one normalized duplicate attempt; owned account/session/event cleanup was verified.
- Auth acceptance retains password hashing, generic invalid-login response, exact registration payload allowlist and Unicode password, confirmation mismatch/correction without registration mutation, cookie attributes, CSRF/Origin denial, storage isolation, cross-tab restoration, logout failure/retry, session expiry, revocation events, repeated logout, and replay of the original in-memory revoked cookie returning 401. Pending registration/login/logout gates assert a single mutation. Auth traces/screenshots are disabled; secrets are not persisted in reports.
- Playwright MCP separately completed a real, restricted-stack registration → login → reload restoration → logout journey after an equivalent environment/identity/role/readiness/schema/denial preflight. The separately budgeted run used one unique synthetic account; linked registration/login/logout events and revoked session were verified before exact-account/session/event cleanup, which left zero account records. Only its own API/web process trees and ephemeral keys were stopped/removed. The anonymous-session 401 is expected.
- The stale ownership recovery path was exercised against a manifest for a nonexistent synthetic email from a terminated test process; real-stack preflight/recovery and 2/2 targeted browser checks passed, and only that manifest was removed. No production frontend/backend defect was confirmed; initial failures were stale test locators/assertions corrected in the harness.
- `.artifacts/weylume/mcp-final-anonymous.yml` is sanitized browser evidence; approved visual Build screenshots were preserved. Actual browser zoom and password-manager autofill were not verifiable in the available browser tooling. Controlled 503/malformed responses are simulated behavior, not a claim of a real backend outage.
- Final gates passed: `npm run test:web` (6 files / 26 tests), `npm run typecheck`, `npm run build` (API and Web), and `git diff --check`. Overall WY-00–WY-12 Scenario Testing result: **PASS**; the next phase remains separately authorized.

Run focused and relevant suites after changes, then applicable app-local tests, root integration/browser scenarios, typechecks/builds. Track a failure/regression in the active approved task plan/handoff with the failing command, scenario path, observed result and resolution. Feature plans must name test scenario paths and verification commands. Never hide failures with skipped tests or zero-test runs. Use risk-based browser verification: UI behavior, responsive, navigation, accessibility, or API/UI contract changes warrant a relevant browser scenario; a small CSS-only change may use focused component/runtime checks rather than the full browser matrix.
