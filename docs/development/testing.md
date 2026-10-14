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
| `npm run test:e2e` | Headless Playwright foundation suite against explicit dummy Neo4j settings |
| `npm run test:e2e:auth` | Separate desktop/mobile browser auth journeys against restricted real `isn-test` and V2 readiness |
| `npm run test:e2e:headed` | Run Playwright with a visible browser |
| `npm run test:e2e:ui` | Open Playwright UI mode |
| `npm run test:e2e:report` | Open the latest generated HTML report |
| `npm run test:root:e2e` | Alias for the Playwright browser suite |
| `npm run test:root` | Root integration scenario followed by browser QA |
| `npm run typecheck` | API and Web typechecks |
| `npm run build` | API and Web production builds |

The integration check uses Node 24's built-in [`node:test` runner](https://nodejs.org/docs/latest-v24.x/api/test.html). Browser QA uses pinned [`@playwright/test` 1.64.0](https://playwright.dev/docs/intro) and its matching Chromium build. Install that browser once with `npx playwright install chromium`. The foundation Playwright servers use strict ports 3301/5174; the real-auth config uses 3302/5175. Both refuse to reuse unrelated servers. Foundation browser/API contract tests set a non-routable dummy Neo4j endpoint and do not prove DB access. The `test:neo4j` and auth browser targets load ignored `apps/api/.env.test.local`, validate `NODE_ENV=test` and `NEO4J_DATABASE=isn-test`, reject development credentials, verify the dedicated identity and deny dev-database access before writes. The auth browser target also checks `/ready` schema V2 before mutations. Test data cleanup is limited to exact synthetic fixture identities/records; no target resets or broadly cleans graph data. See [Neo4j operations](neo4j-operations.md).

The foundation browser config runs desktop Chromium and iPhone 13 mobile emulation on ports 3301/5174 with dummy Neo4j settings. Authentication browser QA uses a separate config on ports 3302/5175; it requires the ignored dedicated `apps/api/.env.test.local`, verifies restricted test identity/roles, V2 readiness and denied `isn-dev` access, uses ephemeral signing keys, and cleans only its owned synthetic records. Auth screenshots and traces are disabled because form inputs and requests can contain secrets; sanitized Playwright reports and test output remain under ignored `.artifacts/playwright/`. Before a registration request, the auth suite records that generated synthetic email in an ignored per-account ownership manifest; successful teardown deletes only that exact account and linked sessions/events, while a later preflight can recover manifests left by a terminated run. The foundation suite may retain browser screenshots/traces because its session behavior is controlled simulation and no credentials are entered. Core auth journeys exercise real API and Neo4j behavior; they are not evidence of production deployment readiness.

The API HTTP suite allocates one ephemeral key directory per Jest invocation in
ignored `apps/api/.artifacts`. Global teardown resolves that directory under the
allowlisted root and verifies its invocation marker before deleting only its own
keys. It never sweeps other runs' directories. The saved real-auth journeys also
check login/logout broadcasts to a second, unfocused page and registration/login
with 100 supplementary Unicode characters (200 UTF-16 code units).

## Verification record

For the Playwright QA build: `npm run test:root` passed (1 root HTTP integration test + 12 browser tests across desktop/mobile Chromium); the final `npm run test:e2e` passed (12/12); `npm test` passed (18 API unit tests + 30 Web tests); `npm run test:api:e2e` passed (1 test); `npm run typecheck` and `npm run build` passed. A temporary, uncommitted failing smoke scenario confirmed screenshots and traces are captured; it was removed, and the final report was regenerated by the passing suite. The expected Nest Jest Node VM-modules experimental warning remains. Rerun relevant commands after future code changes.

For the authentication increment on 2026-10-13: V1 checksum remained unchanged and cumulative V2 was verified on `isn-test`; scoped token setup resolved Neo4j's nonexistent-token privilege activation behavior. The real `npm run test:neo4j` and `npm run test:e2e:auth` passed using synthetic owned fixtures, including duplicate races, transaction rollback, 24-hour session restoration/revocation/replay denial, browser reload, expired session handling, and denied `isn-dev` access. `npm test` passed (66 API tests + 32 Web tests), `npm run test:api:e2e` passed (6), `npm run test:integration` passed (1), and foundation `npm run test:e2e` passed (12). The MCP visual loop found and corrected SVG circles defaulting to black fill; desktop, tablet and mobile views and password visibility were rechecked. The dependency-only `npm audit --omit=dev` reported 0 vulnerabilities. Final typecheck/build/full audit and OpenAPI parsing are recorded in the task handoff. Dummy-endpoint tests are not database evidence.

For future scenarios: unit tests should isolate one owned rule; integration tests should cross a real component boundary and use real services where repeatable/available (otherwise document boundary doubles); E2E tests should exercise a critical user/system flow against running components. Avoid calling an in-memory mock an integration test. Plan tests for privacy, deterministic fixtures, cleanup, and network/resource requirements before writing them.

## Weylume Scenario Testing acceptance record (2026-10-14)

- `npm run test:e2e -- foundation.spec.ts` — **12/12 passed** across desktop and mobile Chromium. Coverage includes independent Vite `/api/health` forwarding, anonymous Weylume home without a homepage health request/card, header/footer/section navigation, CTAs and redesigned not-found, controlled simulated session 503 and malformed-response states, no overflow at 1440×900, 768×1024, 390×844 and 320×740, skip-link focus, and reduced motion.
- `npm run test:e2e:auth` — **10/10 passed** across desktop and mobile Chromium on React → NestJS → restricted Neo4j `isn-test`. Preflight verified `NODE_ENV=test`, dedicated `isn_test_runner` with `PUBLIC` and `isn_test_runner_role`, schema V2 readiness, and explicit `isn-dev` denial before writes. The suite stayed within five valid registration requests per API process/hour: four successful accounts and one normalized duplicate attempt; owned account/session/event cleanup was verified.
- Auth acceptance retains password hashing, generic invalid-login response, exact registration payload allowlist and Unicode password, confirmation mismatch/correction without registration mutation, cookie attributes, CSRF/Origin denial, storage isolation, cross-tab restoration, logout failure/retry, session expiry, revocation events, repeated logout, and replay of the original in-memory revoked cookie returning 401. Pending registration/login/logout gates assert a single mutation. Auth traces/screenshots are disabled; secrets are not persisted in reports.
- Playwright MCP separately completed a real, restricted-stack registration → login → reload restoration → logout journey after an equivalent environment/identity/role/readiness/schema/denial preflight. The separately budgeted run used one unique synthetic account; linked registration/login/logout events and revoked session were verified before exact-account/session/event cleanup, which left zero account records. Only its own API/web process trees and ephemeral keys were stopped/removed. The anonymous-session 401 is expected.
- The stale ownership recovery path was exercised against a manifest for a nonexistent synthetic email from a terminated test process; real-stack preflight/recovery and 2/2 targeted browser checks passed, and only that manifest was removed. No production frontend/backend defect was confirmed; initial failures were stale test locators/assertions corrected in the harness.
- `.artifacts/weylume/mcp-final-anonymous.yml` is sanitized browser evidence; approved visual Build screenshots were preserved. Actual browser zoom and password-manager autofill were not verifiable in the available browser tooling. Controlled 503/malformed responses are simulated behavior, not a claim of a real backend outage.
- Final gates passed: `npm run test:web` (6 files / 26 tests), `npm run typecheck`, `npm run build` (API and Web), and `git diff --check`. Overall WY-00–WY-12 Scenario Testing result: **PASS**; the next phase remains separately authorized.

Run focused and relevant suites after changes, then applicable app-local tests, root integration/browser scenarios, typechecks/builds. Track a failure/regression in the active approved task plan/handoff with the failing command, scenario path, observed result and resolution. Feature plans must name test scenario paths and verification commands. Never hide failures with skipped tests or zero-test runs. Use risk-based browser verification: UI behavior, responsive, navigation, accessibility, or API/UI contract changes warrant a relevant browser scenario; a small CSS-only change may use focused component/runtime checks rather than the full browser matrix.
