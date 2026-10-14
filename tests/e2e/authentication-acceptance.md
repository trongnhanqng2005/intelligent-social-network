# Authentication E2E acceptance matrix

Owner-approved browser acceptance scenarios for `feature/authentication`.
Playwright Test runs Chromium against the Vite frontend and NestJS API on the
dedicated ports in `auth.playwright.config.ts`, with the restricted `isn-test`
identity. Interactive Playwright MCP evidence is recorded separately below.

## Scenario-to-automation mapping

| ID | Preconditions / owned fixture | User action and expected outcome | Automated mapping / dependencies | Initial coverage gap |
|---|---|---|---|---|
| E2E-01 Registration success | Verified `isn-test`, restricted test role; unique `.invalid` email; fixture user ID recorded from registration response | Register in browser; success feedback; account, Argon2id hash and `AUTH_REGISTERED` event persist; response contains no password/JWT | `specs/authentication.spec.ts` registration journey; Vite + NestJS + Neo4j | Existing journey checked UI/event types but did not query persisted hash/account/event for that registration |
| E2E-02 Validation and duplicate | Same synthetic identity as E2E-01; no additional successful registration | Required, invalid email/password are rejected with Vietnamese feedback and no account; differently cased duplicate is rejected without another user/event | `specs/authentication.spec.ts` registration journey; real NestJS/Neo4j | Existing journey covered exact-case duplicate only; no browser assertions for invalid fields or normalized duplicate |
| E2E-03 Login success/failure | E2E-01 account | Wrong password rejected; valid login navigates to authenticated home; cookie is HttpOnly/SameSite and test-appropriate Secure; response does not expose JWT/password | `specs/authentication.spec.ts` registration/session journey; Vite + NestJS + Neo4j | Existing journey covered credentials/navigation, not browser cookie attributes or login body leakage |
| E2E-04 Session restoration | Authenticated real session | Reload restores authenticated UI; `/auth/session` verifies server-side session | `specs/authentication.spec.ts` registration/session journey; Vite + NestJS + Neo4j | Existing journey checked reload UI, not explicit authenticated API response/restoration flash state |
| E2E-05 Logout and revocation | Authenticated session identified by JWT `jti`; user-owned fixture | Logout returns browser to anonymous; Neo4j records `revokedAt` and logout event; replay is denied; repeat logout is 204 | `specs/authentication.spec.ts` registration/session journey; `apps/api/test/auth.e2e-spec.ts` idempotent HTTP contract; real Neo4j query | Existing browser test checked UI/replay/event type but not stored revocation or real-API repeated logout |
| E2E-06 CSRF and Origin | Browser context with real session and its CSRF context | Missing/forged CSRF and invalid Origin rejected; matching Origin/token request reaches business validation; login/logout CSRF rotation remains valid | `specs/authentication.spec.ts`; `apps/api/test/auth.e2e-spec.ts`; real Vite/API/Neo4j | Negative Origin/CSRF cases existed only in HTTP contract test using persistence doubles |
| E2E-07 Multiple tabs and session state | Browser context shared tabs; owned synthetic account/session | Login/logout broadcasts state; next server interaction after revoke/expiry is anonymous; controlled Neo4j expiry avoids waiting 24h | `specs/authentication.spec.ts` tab and expiry journeys; Vite + NestJS + Neo4j | Existing browser journeys covered broadcast and expiry; explicit stale-tab API recheck to be confirmed |
| E2E-08 Failures and UX | Real app; controlled request failure only for outage simulation | Unavailable/retry feedback recovers when request is restored; keyboard and mobile layout usable; Vietnamese UI remains intact | `specs/authentication.spec.ts`; `page.route` controlled failure labeled simulated; real Vite/API/Neo4j for recovery | Existing browser test covered responsive width and limited keyboard traversal; no browser retry/recovery journey |

## Execution evidence

| Scenario | Result | Playwright Test evidence | Interactive Playwright MCP evidence |
|---|---|---|---|
| E2E-01 | PASS | `authentication.spec.ts`: real registration response + direct `isn-test` query; Argon2id hash is not the password; `AUTH_REGISTERED`; fixture ID retained for scoped teardown. | Real registration submitted in MCP at `/dang-ky`; Vietnamese success status observed. The MCP account's Argon2id hash/event were checked and the exact owned user/session/events removed afterward. |
| E2E-02 | PASS | `authentication.spec.ts`: blank required email, valid email with missing password, malformed email, short password, and uppercase normalized duplicate. All expected 422/409 responses and Vietnamese field feedback; no invalid account persisted. | Registration form/error feedback was directly inspected during the MCP journey; the exhaustive cases are automated. |
| E2E-03 | PASS | `authentication.spec.ts`: wrong password → generic 401 UX; successful UI login → authenticated home; local test cookie is HttpOnly, SameSite=Lax, Secure=false for HTTP test origin; login/registration response contains no password/JWT field; auth-like local/session storage key names absent. | Valid login submitted in MCP and authenticated home/email state observed; logout control was usable. No cookie/token values were inspected in MCP. |
| E2E-04 | PASS | `authentication.spec.ts`: real session request returns 200 after reload. A held session request keeps the loading UI visible until released; authenticated UI restores from server-verified session without anonymous flash. | Page reload/restoration is covered by the automated real-browser journey. |
| E2E-05 | PASS | `authentication.spec.ts`: UI logout returns 204; Neo4j `revokedAt` and `AUTH_LOGOUT` verified; second tab reload and session request return anonymous/401; repeated API logout returns 204; signed-cookie replay returns 401. | MCP logout returned the UI to anonymous navigation. Independent restricted-identity query confirmed registration/login/logout events and revoked session before scoped cleanup. |
| E2E-06 | PASS | `authentication.spec.ts`: real browser-context session/API requests reject attacker Origin, missing CSRF and forged token (403); the same-origin UI logout with valid session CSRF succeeds (204), and refreshed anonymous-context repeat logout succeeds (204). API HTTP contract also retains origin/CSRF checks. | MCP journey exercised the real same-origin registration/login/logout flow. No secret/token values were displayed. |
| E2E-07 | PASS | `authentication.spec.ts`: second tab receives login/logout state; after logout reload it verifies server session is 401; isolated Neo4j expiry mutation makes restoration anonymous without waiting 24h. | Multi-tab and controlled-expiry behavior is repeatably automated; MCP completed login/logout in one real browser context. |
| E2E-08 | PASS | `authentication.spec.ts`: Playwright route abort deliberately simulates unavailable session request; retry removes interception and recovers against real API. Mobile/desktop projects also cover keyboard traversal and 360px no-overflow. This is simulated transport failure, not an actual Neo4j outage. | MCP inspected desktop registration/login/logout and a 390×844 registration viewport; measured document/body width equals viewport (390px). Anonymous bootstrap produced two expected `/auth/session` 401 console resource messages (React StrictMode); no warnings or other console errors observed. |

## Final run record (2026-10-13)

- `npm run test:e2e:auth` — **10/10 passed**, Chromium desktop and mobile projects, one worker, against real Vite, NestJS and positively preflighted restricted `isn-test` (`isn_test_runner`; roles `PUBLIC` + `isn_test_runner_role`; schema V2 ready; `isn-dev` denied). Registration writes stayed within the API's five-per-process budget; only four unique accounts were created across the suite, plus one desktop normalized-duplicate attempt. The suite's owned-ID cleanup completed.
- MCP actually navigated and interacted with the running application: registered synthetic account, observed success, navigated to login, submitted credentials, observed authenticated home, clicked logout and observed anonymous home; inspected registration at desktop and 390×844 mobile width. Snapshot evidence: `.playwright-mcp/page-2026-10-13T14-22-15-176Z.yml`, `14-22-24-511Z.yml`, `14-22-47-637Z.yml`, `14-23-00-688Z.yml`, and `14-23-14-509Z.yml` (all under `.playwright-mcp/`).
- MCP-only synthetic account was separately verified with the restricted identity: persisted Argon2id hash, registration/login/logout events and revoked session. Cleanup matched its exact synthetic email to its owned user ID, deleted only that user's linked sessions/events, verified zero remaining users for that ID, and separately reconfirmed `isn-test` identity and `isn-dev` denial. No test/dev user, password, JWT, CSRF or cookie values were emitted.
- Initial expanded-run failures were assertion/harness defects, not application defects: route removal auto-handled a held Playwright request, and API validation checks email before password. The route is now released before unregistering its handler; validation assertions now isolate missing/invalid email and password cases. Final complete run passed after these corrections. No production code changes were needed.
- Outage evidence is explicitly a Playwright `route.abort` simulation followed by a real API recovery request. No shared API/Neo4j service was disrupted, and no actual Neo4j-outage claim is made.

No credentials, cookie values, CSRF values, or account secrets belong in this
matrix. Any intercepted outage is simulated evidence, not proof of an actual
Neo4j outage. Test fixture cleanup is limited to user IDs created by this
Playwright invocation after its positive database identity preflight.

## Weylume Scenario Testing acceptance (Owner-approved, 2026-10-14)

This section records the approved WY-00–WY-12 frontend acceptance after the
Weylume redesign. It supplements, and does not rewrite, the historical
`feature/authentication` acceptance above. Playwright Test owns the repeatable
desktop/mobile checks; Playwright MCP contributes one separately preflighted
real-stack journey. Foundation session interceptions and all deliberate outage
responses are browser simulations, not backend outage evidence.

| ID | Result | Acceptance evidence |
|---|---|---|
| WY-00 | PASS | Auth Playwright preflight and separate MCP preflight verified effective test environment, `isn-test`, `isn_test_runner`, `PUBLIC` + `isn_test_runner_role`, V2 `/ready`, and denial of `isn-dev` before writes. Four successful registrations plus one desktop duplicate were within the five-valid-register-request per-process/hour limit; MCP used a separate runtime and one account. Exact-owned cleanup and zero remaining records verified. |
| WY-01 | PASS | Foundation uses controlled anonymous-session 401 and proves current Weylume home/branding without a home `/api/health` request/card. MCP independently opened the real home; its anonymous session 401 was expected. Proxy health remains tested separately. |
| WY-02 | PASS | Desktop/mobile browser checks exercised brand/home, header and footer links, hero CTA, section anchors, login/registration routes, unknown route and redesigned not-found return link. |
| WY-03 | PASS | Real auth journey submits mismatched confirmation, proves no registration mutation/account, corrects it, and registers one account with the exact 100-character supplementary Unicode password. The payload has only email/password, success does not log in, and both password fields clear. MCP also registered with confirmation and observed no auto-login/cleared fields. A separate CSRF bootstrap/refresh is allowed. |
| WY-04 | PASS | Required, malformed email, missing/short password and normalized duplicate checks return expected 422/409 and Vietnamese accessible feedback; invalid/duplicate attempts create no account. No extra successful account was added for validation. |
| WY-05 | PASS | Wrong password keeps the generic login error; correct credentials show the current welcome and identity. Hashing, response secret exclusion, cookie attributes and auth-storage assertions remain active. |
| WY-06 | PASS | Held real session restoration keeps loading state without anonymous-link flash; reload restores the authenticated UI. A shared second tab observes login/logout state and rechecks server authorization. MCP reload also restored its real session. |
| WY-07 | PASS | The original authenticated cookie is captured only in memory before logout. UI logout retry succeeds, the stored session is revoked and `AUTH_LOGOUT` recorded; replaying that exact original cookie returns 401. Repeated logout remains idempotent. MCP separately observed anonymous UI and session 401. |
| WY-08 | PASS | Only the owned account's session expiry is changed; restoration rejects it and returns the browser to anonymous state. |
| WY-09 | PASS | Controlled session 503, malformed-session response and logout 503 are labeled simulations. Manual retry removes interception and recovers against the real API; logout failure preserves identity until retry succeeds. |
| WY-10 | PASS | Held registration, login and logout requests verify busy/disabled UI and reject repeat Enter/click/double-click mutations. Each real journey reuses its one account. |
| WY-11 | PASS | Foundation home and forms are checked at 1440×900, 768×1024, 390×844 and 320×740 for document overflow, control bounds, 44px header CTA targets and usable section navigation. Auth/MCP also exercise narrow 320px registration/login; MCP found document width equal to viewport. |
| WY-12 | PASS | Visible keyboard focus and skip links that transfer focus to main/form destinations, validation-summary focus, labels/`aria-describedby`, password visibility toggle and reduced-motion overrides are checked. MCP confirmed 320px skip-link focus. |

### Initial failures and resolution (test-harness/environment only)

| Scenario | Expected vs. actual | Classification and correction | Final result |
|---|---|---|---|
| WY-01 | Expected one accessible Weylume home link; the locator also matched the footer brand link. | Locator ambiguity; scoped the assertion to the banner. No product change. | Foundation 12/12 passed. |
| WY-03 | Expected a single password textbox; the partial accessible name also matched confirmation. One early page-evaluation assertion also referenced a Node variable not passed into browser context. | Test-harness locator/context errors before registration submission; use an exact locator and pass the expected string explicitly to evaluation. | Full real-stack suite passed; account budget/cleanup verified. |
| WY-04 | Expected `#password-error` and an exact `aria-describedby`; actual rendered ID was `#auth-password-error`, and the valid hint is also described. | Updated assertions to current IDs and require the error ID in the space-separated description. No validation behavior was weakened. | Desktop/mobile validation checks passed. |
| WY-09 | Expected the outage state after the first session request; React StrictMode may issue more than one bootstrap request. | Simulation counter depended on request ordering; changed the test gate to switch explicitly to recovery before retry. | Controlled 503 then real-API retry passed; malformed response also passed. |
| WY-11–WY-12 | Expected password controls to be label/textbox matches and show a focus ring before keyboard focus; actual semantic role required a textbox locator and the visible ring applied after focus to the skip link. | Updated semantic locators and tested the actual keyboard-focused skip link. | Four viewport checks and focus assertions passed. |

The first isolated MCP server bootstrap used an npm CLI path that was not
installed in the workspace; its launchers exited before any DB write. The
runtime was relaunched via the installed npm CLI, both endpoints were verified,
and the full independent DB preflight passed before the MCP account was created.

### Weylume execution results and artifact safety

- `npm run test:e2e -- foundation.spec.ts` — **12/12 passed** (desktop and mobile Chromium).
- `npm run test:e2e:auth` — **10/10 passed** (desktop and mobile Chromium, real React → NestJS → restricted Neo4j `isn-test`). No auth browser tests were skipped or run with zero tests.
- Independent-review regressions: the auth component test file passed **10/10**, including repeated same-error focus; targeted foundation checks passed **4/4** across desktop/mobile, including both skip-target focus/outline and 44px targets.
- Stale ownership-manifest recovery was exercised with a terminated-process manifest for a nonexistent synthetic account; preflight/recovery ran before browser tests, the exact manifest was removed, and the focused 2/2 desktop/mobile recovery-state checks passed.
- Playwright MCP completed homepage → registration → login → authenticated welcome → reload restoration → logout → anonymous session 401. It used a separately generated ephemeral signing/CSRF key set and a pre-recorded synthetic email. The exact account's registration/login/logout events and revoked session were verified; only that account and its linked sessions/events were deleted, leaving zero matching users. The runtime processes and ephemeral keys were stopped/removed.
- Auth screenshots and traces are disabled. Passwords, original cookies, CSRF tokens and hashes remained in memory; reports contain sanitized outcomes only. No screenshot was taken while credentials were visible. Sanitized final snapshot: `.artifacts/weylume/mcp-final-anonymous.yml`; approved visual-refinement screenshots remain preserved under `.artifacts/weylume/`.
- MCP browser network inspection showed app scripts, styles, fonts and favicon at 200/304; its only console errors were expected anonymous session 401s. No warnings, broken assets or unexpected console errors were observed. No production application defect was confirmed; corrected failures were stale E2E selectors/focus assertions. Actual browser zoom and password-manager autofill were not verifiable. No real Neo4j outage was simulated or claimed.

Final Scenario Testing status: **PASS**. `npm run test:web` passed (6 files / 26
tests), `npm run typecheck`, `npm run build` (API and Web), and `git diff --check`
passed after the final E2E runs. Stop after this phase; independent Code Review
and Git publication require their separate authorization.
