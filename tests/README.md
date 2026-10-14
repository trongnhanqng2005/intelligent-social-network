# Root project test scenarios

`tests/` is the authoritative location for new AI-authored project-level scenarios. Keep app-specific tests with their existing frameworks; do not migrate or duplicate passing tests.

## Test ownership and placement

| Scenario | Location | Runner / command |
|---|---|---|
| API rule/provider behavior | `apps/api/src/**` | Jest; `npm run test:api` |
| API HTTP contract | `apps/api/test/` | Jest + Supertest; `npm run test:api:e2e` |
| React component, hook, route behavior | `apps/web/src/**` beside source | Vitest + RTL; `npm run test:web` |
| Project-level isolated rule not owned by one app | `tests/unit/<domain-or-feature>/*` (only when justified) | Node `node:test`; invoke focused file directly |
| Real component/service boundary without a browser | `tests/integration/<boundary-or-feature>/*.test.mjs` | Node `node:test`; `npm run test:integration` |
| Real Neo4j authentication/profile integration | `tests/integration/neo4j/*.test.mjs` | Node `node:test`; `npm run test:neo4j`, dedicated `isn-test` credentials required |
| Real Neo4j Friendship integration and graph invariants | `tests/integration/neo4j/friendships.test.mjs` | Node `node:test`; `npm run test:neo4j:friendships`, current-V4 preflight plus exclusive restricted `isn-test` write window required |
| Complete user/system flow in a real browser | `tests/e2e/specs/<feature-or-journey>.spec.ts` | Playwright Test; `npm run test:e2e` |
| Real-stack profile/discovery browser acceptance | `tests/e2e/specs/user-profile-discovery.spec.ts` | Playwright Test; `npm run test:e2e:profile`, restricted `isn-test` required |
| Real-stack Friendship browser acceptance | `tests/e2e/specs/friendship-system.spec.ts` | Playwright Test; `npm run test:e2e:friendships`, restricted `isn-test` and owned-fixture cleanup required |
| Shared deterministic test data | `tests/fixtures/<domain-or-purpose>/` only when reused | Owned by the scenarios that consume it |

Current root tests:

- `integration/api-proxy.test.mjs`: real API + Vite HTTP proxy contract, without browser automation.
- `integration/neo4j/auth.test.mjs` and `integration/neo4j/users.test.mjs`: real authentication/profile persistence, isolation, search and concurrent versioned update scenarios on restricted `isn-test`.
- `e2e/playwright.config.ts` and `e2e/specs/foundation.spec.ts`: real Chromium browser journeys across desktop and emulated mobile projects.
- `e2e/auth.playwright.config.ts` and `e2e/specs/authentication.spec.ts`: real registration/session journeys against restricted `isn-test`; excluded from ordinary dummy-database browser QA.
- `e2e/profile.playwright.config.ts` and `e2e/specs/user-profile-discovery.spec.ts`: UPD-01–08 real-stack browser acceptance against restricted `isn-test`; excluded from ordinary dummy-database browser QA. See the [acceptance record](e2e/user-profile-discovery-acceptance.md).
- `integration/neo4j/friendships.test.mjs`, `integration/neo4j/friendship-acceptance-preflight.mjs`, and `fixtures/friendships/acceptance-support.cjs`: read-only current-V4 gate plus focused real-DB scenarios and exact ownership/recovery manifests. `tests/unit/friendship-acceptance-support.test.cjs` verifies manifests do not persist raw account/auth baseline records.
- `e2e/friendship.playwright.config.ts` and `e2e/specs/friendship-system.spec.ts`: FS-00–FS-10 real-stack Friendship acceptance on dedicated ports 3311/5181; excluded from ordinary dummy-database browser QA. See the [acceptance record](e2e/friendship-system-acceptance.md).
- `integration/neo4j/profile-readiness.test.mjs`: read-only UPD-00 identity/schema/data preflight; does not migrate or write fixtures.

Use **unit** for isolated behavior, **integration** for a real boundary between components/services, and **E2E** for observable user/system behavior across the running application. A browser test is E2E, not an integration test. Do not create empty category directories or placeholder tests.

## Browser QA conventions

- `tests/e2e/` is the only approved home for new root browser QA. Use Playwright Test files named `specs/<feature-or-user-journey>.spec.ts`; name each case as observable behavior (`user can ...`, `shows ... after ...`). Split by feature or journey when the suite grows, not by arbitrary technical layer.
- Use Playwright Test (`@playwright/test`) for saved, repeatable browser tests. Use Playwright MCP for interactive inspection/debugging, not as a replacement for committed test scenarios. Preserve Jest, Vitest/RTL and Node `node:test` for their current responsibilities.
- Prefer semantic locators (`getByRole`, accessible names, labels, and text tied to user-visible behavior). Avoid CSS selectors, implementation state, fixed sleeps and brittle positional selectors. Wait on Playwright assertions and specific navigation/network outcomes.
- Use real local API and frontend services for core E2E contracts. Intercept only to create a controlled failure, malformed response, or otherwise unsafe/unavailable condition; mark those tests as simulated and do not claim a mocked response proves backend integration. Remove the interception before asserting real recovery.
- Tests must be isolated, deterministic, and own only their per-test browser context and test data. Use synthetic data; avoid shared accounts and real personal data. Clean up data/resources the test created. Do not stop shared services inside tests.
- Configured Playwright servers use dedicated strict ports and `reuseExistingServer: false`; a port conflict should fail clearly rather than reuse or terminate an unrelated developer process. Server processes are started/stopped by Playwright's `webServer` lifecycle.
- Check accessibility as behavior: semantic controls, keyboard navigation, visible focus and usable mobile targets. Assert layout outcomes (viewport overflow/clipping) rather than exact pixels unless visual regression is explicitly intended.
- Playwright writes HTML reports, screenshots and traces under `.artifacts/playwright/`, which is ignored by Git. Inspect with `npm run test:e2e:report`; investigate failures via report/trace before changing assertions. Never weaken an assertion to silence a real defect.

## Commands

```sh
npm run test:integration       # HTTP boundary test
npm run test:e2e               # Headless Playwright desktop + mobile suite
npm run test:e2e:auth          # Real auth journey against restricted isn-test
npm run test:neo4j:profile-preflight # Read-only restricted isn-test V4 readiness gate
npm run test:neo4j:friendship-preflight # Preserved read-only V1-V3 pre-migration gate
npm run test:e2e:profile       # Real-stack profile/discovery browser acceptance
npm run test:neo4j:friendship-acceptance-preflight # Read-only current-V4 FS-00 gate
npm run test:neo4j:friendships  # Focused real-DB writer; exclusive write window required
npm run test:e2e:friendships    # Current-V4 preflight + real-stack browser acceptance
node --test tests/unit/friendship-acceptance-support.test.cjs # Manifest-redaction unit check
npm run test:e2e:headed        # Visible browser runs
npm run test:e2e:ui             # Playwright UI mode
npm run test:e2e:report         # Open the latest local HTML report
npm run test:root              # Root integration + browser QA
npm run neo4j:provision-test   # Explicit local admin provisioning, once/repeat-safe
npm run neo4j:migrate:dev      # Explicit dev schema migrations
npm run neo4j:migrate:test     # Explicit test schema migrations
npm run neo4j:status:test     # Read-only migration verification
npm run test:neo4j             # Real Neo4j integration; requires ignored test env file
npm test                       # Existing app-local API and Web tests
```

Install the browser once after dependency installation with `npx playwright install chromium`. The pinned Playwright version selects its required browser revision. The test configuration starts the API and Vite frontend on dedicated loopback ports; no pre-running app is needed. Only desktop/mobile Chromium is configured initially. Other browser engines are not verified.

The profile and Friendship acceptance commands load ignored `apps/api/.env.test.local`, verify the restricted `isn-test` configuration, and own/clean their synthetic fixtures. Friendship requires the read-only current-V4 `npm run test:neo4j:friendship-acceptance-preflight` before any writer and a separately verified exclusive write window. Do not substitute `npm run test:neo4j` on a live acceptance database: its schema scenario invokes the migration runner and preserves migration-writing/idempotency coverage. See the [profile](e2e/user-profile-discovery-acceptance.md) and [Friendship](e2e/friendship-system-acceptance.md) scenario records.

## Adding/updating QA in a feature task

Every feature task plan must identify affected existing app-local tests and any new/updated root scenario path, test category, real services or explicit mocks, test-data isolation/cleanup, and exact verification command. Add browser scenarios only for meaningful user journeys or risk-bearing UI behavior; do not run the whole E2E suite for every minor CSS-only adjustment. Choose verification proportional to risk: affected component test and targeted browser viewport check for visual-only changes; relevant Playwright journey for navigation, responsive behavior, accessibility, or API/UI state changes; full root suite for cross-cutting changes.

Record failures with the command, scenario, observed result and resolution in the active task handoff. Add a regression scenario where the behavior belongs; distinguish product failures from environment/setup failures. Update [the testing guide](../docs/development/testing.md) and [documentation Definition of Done](../docs/development/workflow.md) when conventions or commands change.
