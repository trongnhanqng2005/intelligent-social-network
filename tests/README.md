# Root project test scenarios

`tests/` is the authoritative location for new AI-authored project-level scenarios. Keep app-specific tests with their existing frameworks; do not migrate or duplicate passing tests.

## Test ownership and placement

| Scenario | Location | Runner / command |
|---|---|---|
| API rule/provider behavior | `apps/api/src/**` | Jest; `npm run test:api` |
| API HTTP contract | `apps/api/test/` | Jest + Supertest; `npm run test:api:e2e` |
| React component, hook, route behavior | `apps/web/src/**` beside source | Vitest + RTL; `npm run test:web` |
| Project-level isolated rule not owned by one app | `tests/unit/<domain-or-feature>/*.test.mjs` (only when justified) | Node `node:test`; no separate root unit scenario currently |
| Real component/service boundary without a browser | `tests/integration/<boundary-or-feature>/*.test.mjs` | Node `node:test`; `npm run test:integration` |
| Real Neo4j foundation integration | `tests/integration/neo4j/*.test.mjs` | Node `node:test`; `npm run test:neo4j`, dedicated `isn-test` credentials required |
| Complete user/system flow in a real browser | `tests/e2e/specs/<feature-or-journey>.spec.ts` | Playwright Test; `npm run test:e2e` |
| Shared deterministic test data | `tests/fixtures/<domain-or-purpose>/` only when reused | Owned by the scenarios that consume it |

Current root tests:

- `integration/api-proxy.test.mjs`: real API + Vite HTTP proxy contract, without browser automation.
- `e2e/playwright.config.ts` and `e2e/specs/foundation.spec.ts`: real Chromium browser journeys across desktop and emulated mobile projects.
- `e2e/auth.playwright.config.ts` and `e2e/specs/authentication.spec.ts`: real registration/session journeys against restricted `isn-test`; excluded from ordinary dummy-database browser QA.

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

## Adding/updating QA in a feature task

Every feature task plan must identify affected existing app-local tests and any new/updated root scenario path, test category, real services or explicit mocks, test-data isolation/cleanup, and exact verification command. Add browser scenarios only for meaningful user journeys or risk-bearing UI behavior; do not run the whole E2E suite for every minor CSS-only adjustment. Choose verification proportional to risk: affected component test and targeted browser viewport check for visual-only changes; relevant Playwright journey for navigation, responsive behavior, accessibility, or API/UI state changes; full root suite for cross-cutting changes.

Record failures with the command, scenario, observed result and resolution in the active task handoff. Add a regression scenario where the behavior belongs; distinguish product failures from environment/setup failures. Update [the testing guide](../docs/development/testing.md) and [documentation Definition of Done](../docs/development/workflow.md) when conventions or commands change.
