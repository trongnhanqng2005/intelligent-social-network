# ISN-C Posts & Feed acceptance report

**Current disposition (2026-10-29): Step 5 Functional Acceptance was accepted by the Project Owner; Step 6 is complete.** Finding #6 (resource-safety evidence) and R4 (Feed reconciliation waiter lifecycle) were addressed with the targeted changes and regression evidence summarized in [testing strategy](../../docs/development/testing.md). Step 7 is limited to publication preparation: changes remain uncommitted and await separate Owner authorization for Git writes. This current disposition supersedes the pending-decision status recorded at the time of the historical Step 5 run below.

**Latest functional execution:** 2026-10-28 · **Branch / HEAD at execution:** `feature/posts-feed` / `15aba8fd5b12954a634f6c0c8f388938e7e036a2`
**Functional execution scope:** PF-15–PF-20 only; no ISN-A/ISN-B work. Earlier sections below are historical checkpoints, not the current disposition.

## Targeted preflight recovery and remaining acceptance — PASS

- Database-free investigation reproduced a concrete source of the previous environment gate failure: importing `AppModule` causes Nest configuration to add `NEO4J_USERNAME` and `NEO4J_PASSWORD` to the worker environment with the dedicated test values. The unchanged restricted-target gate rejects either development credential variable on a subsequent scenario. This explains the observed pattern plausibly, but the prior report suppressed the actual assertion, so its precise historical root cause cannot be established conclusively.
- `scenario-support.mjs` now restores the worker environment immediately after the app import, only when both inserted values match the existing test credentials; unexpected values remain in place and the guard continues to fail closed. No credential values are logged. Database-free `tests/unit/posts-scenario-environment.test.mjs` imports the app twice in a synthetic restricted environment and rechecks the actual target guard after each import; it makes no DB connection. The underlying contamination was reproduced separately before the fix. Full Posts database-free suite **50/50 PASS**; `git diff --check` PASS.
- Added runner `--remaining-cases` to select only PF-16, PF-18 edit/Feed, PF-19 lost-response, and PF-20; discovery confirmed exactly **4** tests. All existing runner, resource, identity, ownership, per-scenario preflight, cleanup, and preservation guards remain intact. No production code or business assertions changed.
- Owner freshly confirmed exclusive `isn-test` access and no ISN-B Spark overlap. One targeted invocation `npm run test:e2e:posts -- --remaining-cases` ran four independent Playwright tests, one worker, zero retries: **4 PASS / 0 FAIL / 0 skipped / 0 flaky**. PF-16 stale-version conflict/reload/draft retention **PASS**; PF-18 simulated aborted edit and Feed refresh/load-more recovery **PASS**; PF-19 simulated lost response after real commit and reconciliation **PASS**; PF-20 controlled delayed Feed delivery across revocation, deletion and route change **PASS**. The real-commit/lost-response and transport faults were deliberately simulated, not proof of an actual database transport outage.
- Consolidated PF status: **PF-00–PF-14 PASS inherited** from grouped runs; **PF-15 and PF-17 PASS inherited** from run `fccd6313-8273-4d37-b7e8-2f75dc586d9e`; **PF-16 PASS new**; **PF-18 PASS** combining inherited aborted-create and new edit/Feed tests; **PF-19 PASS** combining inherited explicit-unknown and new lost-response tests; **PF-20 PASS new**; **PF-21–PF-23 PASS inherited**, including four authenticated viewports. No confirmed application defect was detected. Prior failed test assertions and infrastructure gates remain historical, not new product failures.
- Stage A/B/C, post-probe and runtime resource gates passed without warnings; no Spark, unclassified Java, Docker or WSL workloads were detected in the saved inventories. Post-group preflight and exact cleanup passed; final data, schema and privilege fingerprints matched initial baseline and final free-port/manifest preflight passed. The invocation services stopped. Sanitized evidence: `.artifacts/playwright/posts/66f633ce-7c56-4b08-9c83-4be7d65a2e73/run-summary.json`.
- Functional acceptance is **PASS**, based on the combination of new and inherited evidence. Owner decides whether to accept Step 5 and authorize a subsequent phase; no commit, push, merge or independent review was initiated.

## Focused functional acceptance — previous run — BLOCKED (historical)

- Read-only process inspection before execution observed only two Java processes: a Neo4j Desktop launcher (PID 32392) and its Neo4j Enterprise child (PID 36716), both using the Neo4j Desktop runtime. The previous Stage B report retained only a count, not PIDs or command lines, so the two previously unclassified processes cannot be identified retrospectively or equated with the current Neo4j pair. No process was terminated or modified. Owner freshly confirmed exclusive `isn-test` access and no overlapping ISN-B Spark.
- The single `@concurrency-recovery` invocation `fccd6313-8273-4d37-b7e8-2f75dc586d9e` passed initial DB preflight, resource Stage A/B/C and post-probe. Stage B detected two Neo4j Java processes, zero unclassified Java and no Spark; Docker/WSL inventories verified empty. Runtime monitoring passed with paging across three samples recorded as a warning; minimum physical and commit headroom 3,318,312,960 and 7,795,163,136 bytes exceeded measured reserves 1,007,841,280 and 1,234,812,928 bytes respectively.
- **8 Playwright tests attempted: 4 PASS, 4 FAIL, 0 skipped, 0 flaky.** PF-15 overlapping mutations **PASS**; PF-16 stale version **BLOCKED**; PF-17 logout/owned-session expiry **PASS**; PF-18 simulated edit and Feed recovery **BLOCKED**, simulated aborted-create unknown-outcome/reconciliation/manual retry **PASS**; PF-19 simulated lost committed response **BLOCKED**, simulated explicit `WRITE_OUTCOME_UNKNOWN` **PASS**; PF-20 stale delivery/privacy/route isolation **BLOCKED**. Each BLOCKED test actually failed in its pre-fixture environment gate; no business assertion in those four tests executed. PF-00–PF-14 and PF-21–PF-23 retain inherited grouped PASS evidence, including four viewports. No new application defect was demonstrated.
- One infrastructure/environment failure signature affected four independent tests: expected scenario preflight to validate the environment and start each fixture; actual `Posts current-V5 preflight failed at environment; details suppressed` at `tests/integration/neo4j/posts-acceptance-preflight.mjs:162`, called from scenario setup. The saved sanitized report does not identify which environment assertion failed or its root cause; the alternating failures alone do not establish causation. Reproduce using the guarded runner and the named scenarios only after a new Owner-approved safe window. No code was changed to diagnose or fix it, and no rerun was performed.
- Post-group cleanup and preflight passed; final data, schema and privilege fingerprints matched initial baseline, services stopped, final free-port and unresolved-manifest checks passed. Evidence: `.artifacts/playwright/posts/fccd6313-8273-4d37-b7e8-2f75dc586d9e/run-summary.json`. No production code or test infrastructure was changed in this continuation. Await Owner decision on the preflight blocker and remaining business verification before Step 6.

## Import recovery and final functional attempt — 2026-10-28 — BLOCKED

### Infrastructure and technical verification

- Reproduced the exact missing-export error without opening a browser or calling the database. The CommonJS `.ts` Playwright config statically imported `scenario-runner.mjs` through Playwright's CJS transform; the later native ESM scenario-support → preflight import could not obtain its named export. Renamed only the Posts config to `posts.playwright.config.mts`, replaced `__dirname` with `import.meta.url` path resolution, and updated runner/discovery/refusal-test/documentation references. No guard was removed or weakened.
- Added `tests/unit/posts-playwright-module-loading.test.mjs`: actual Playwright discovery loads the real config and natively imports scenario support, checking its exports without calling fixture functions. It failed with the original config and passed with the ESM config. Temporary smoke files live outside `.artifacts` to avoid interfering with existing artifact-preservation tests; an initial parallel unit run exposed that collision, which was corrected before acceptance. Final database-free checks: **49/49 PASS**, strict standalone Playwright TypeScript PASS, discovery **12 tests / 1 file**, and `git diff --check` PASS.
- Prepared eight independent remaining tests: PF-15, PF-16, PF-17, PF-18 edit/Feed recovery, PF-18 aborted create, PF-19 lost response, PF-19 explicit unknown outcome, PF-20 stale delivery. One worker, zero retries, separate fixture ownership and per-scenario read-only preflight remain. Added the other actor's own Post fixture in PF-20 because its profile-card assertion otherwise relied on a Post created by the formerly shared scenario. No business assertion was weakened.
- PF-18 follows `docs/api/posts-feed.md` and `post-composer.tsx`: retain draft, prevent resubmission on `WRITE_OUTCOME_UNKNOWN`, reconcile Feed, require explicit confirmation, then permit one manual retry. The revised assertions remain **UNVERIFIED by business execution**.

### Actual execution and environment

- Owner freshly confirmed exclusive `isn-test` use and no ISN-B Spark overlap. Ran `npm run test:e2e:posts -- --group @concurrency-recovery` once, invocation **`e8da418f-2c60-497f-923d-12a0207b96f3`**. Fresh database preflight and resource Stage A passed. Stage B blocked with `ISN-B Spark activity is active or could not be ruled out.` The stage observed **2 unclassified Java processes**, in addition to 2 classified Neo4j Java processes; `sparkWorkloadActive=null`. This does **not** establish that Spark was running, and the processes were not stopped or modified.
- Stage B headroom was sufficient: minimum available physical **1,469,198,336 bytes** versus measured reserve **173,780,992**, and commit headroom **5,063,680,000** versus **219,115,520**. Docker/WSL inventories were verified empty. Therefore the generic runner message about insufficient/inconclusive capacity means inconclusive workload classification here, not demonstrated RAM exhaustion. No resource policy was changed.
- **Playwright business tests executed: 0** (0 PASS / 0 FAIL / 0 skipped; eight intended tests NOT RUN because the runner stopped before launch). Stage C was not reached. The lightweight module-loading discovery check is not business E2E evidence. No fixture writes, screenshots or traces occurred.
- Runner shutdown and final read-only preservation succeeded: initial/final data, schema and privilege fingerprints matched baseline; free-port and unresolved-manifest checks passed. No production changes, ISN-B operations, additional acceptance invocation, commit, push, merge or Step 6 transition occurred.
- Evidence: `.artifacts/playwright/posts/e8da418f-2c60-497f-923d-12a0207b96f3/run-summary.json` and `.artifacts/playwright/posts/resource-preflight/2026-10-28T16-41-26.372Z.json`.

### Consolidated current coverage

| Cases | Current status | Evidence / limitation |
|---|---|---|
| PF-00–PF-08 | PASS inherited (grouped) | Earlier real-stack authentication/security/Post lifecycle; not rerun |
| PF-09–PF-14 | PASS inherited (grouped) | Run `1495cb2b-0d7c-455d-a05d-88fb2a9d60d9`; visibility/privacy/Feed pagination |
| PF-15 | BLOCKED; current test NOT RUN | Earlier overlapping-race steps completed inside a later-failing group; no current independent result |
| PF-16 | BLOCKED; current test NOT RUN | Earlier stale-version steps completed inside a later-failing group |
| PF-17 | BLOCKED; current test NOT RUN | Earlier session-revocation/expiry steps completed inside a later-failing group |
| PF-18 | BLOCKED; revised test NOT RUN | Earlier test failures were stale assertions; revised unknown-outcome contract remains unverified |
| PF-19 | BLOCKED; business scenario NOT RUN | Lost committed response and explicit unknown-outcome cases prepared separately |
| PF-20 | BLOCKED; business scenario NOT RUN | Delayed Feed privacy/route isolation; own-profile fixture corrected before run |
| PF-21–PF-23 | PASS inherited (grouped) | Run `26a28f2b-857a-49d1-855f-2df0e51f3c34`, including four authenticated viewports |

### Consolidated findings from this continuation

| ID / classification | Impact | Expected / actual and reproduction | Disposition |
|---|---|---|---|
| INF-01 — test infrastructure | Blocks all remaining tests | Config and scenario support must load together; `.ts` CJS config followed by native ESM support import produced missing named export. Reproduced by the module-loading regression test. | Fixed; database-free loader regression PASS; business execution not reached |
| TEST-01 — fixture isolation | Would invalidate PF-20 profile-card assertion | Independent PF-20 needs an owned Post for the viewer; split scenario created only the author's Posts while asserting a viewer profile card exists. Identified by source inspection, not a runtime product failure. | Added exact owned fixture; runtime unverified |
| ENV-01 — environment/workload uncertainty | Blocks acceptance | Workloads must be classified with no overlap; Stage A had zero unknown Java, Stage B had two and could not rule out Spark. Reproduce via the guarded runner under the recorded inventory; process identities/root cause unconfirmed. | OPEN; Owner needs a verified safe workload window before any separately approved run |

**Totals:** 2 test/infrastructure findings addressed, 1 open environment blocker, **0 confirmed application defects** in this continuation. Absence of business execution is not evidence that the product is defect-free. No further fix/retest cycle was undertaken. Step 5 remains BLOCKED; await Owner decision.

## One-pass remaining acceptance — 2026-10-28 — BLOCKED

- Adjusted PF-18's aborted-create assertions to require unknown-outcome messaging, retained draft, disabled resubmission, successful Feed reconciliation and explicit user confirmation before one manual retry; assertions still require no automatic repeat and exactly one persisted Post. Split PF-15–PF-17, PF-18, PF-19 and PF-20 into independent Playwright tests with separate fixtures; PF-19 resets the unknown-outcome state through the approved reconciliation flow before its next create. Each scenario setup invokes the existing read-only preservation/manifest preflight before fixture writes. Playwright is configured for one worker and zero retries; tests no longer share serial-mode failure propagation.
- Database-free Posts unit tests **48/48**, strict standalone Playwright TypeScript, JS syntax and discovery (**8 tests / 1 file**) passed before the run. These checks did not expose the runtime Playwright module-loader failure.
- Owner freshly confirmed exclusive `isn-test` use and no ISN-B Spark overlap. The one `@concurrency-recovery` invocation `4804f2c9-0f1e-473e-9178-128814c00d28` passed database preflight, Stage A/B/C, post-probe and resource monitoring. Playwright attempted **4 tests: 0 passed, 4 failed, 0 skipped**. All four stopped while importing scenario support, before `createPostsScenario` or any business assertion/fixture write: `SyntaxError: The requested module '../../fixtures/posts/scenario-runner.mjs' does not provide an export named 'assertPostsScenarioExecutionTarget'`. The failure was introduced in this continuation's new scenario-support → preflight import path; `scenario-runner.mjs` source does declare the named export, so the Playwright module-resolution/transform cause is not confirmed. No retry or post-failure code fix was performed.
- PF-15–PF-17 and PF-18 remain unverified by this invocation, and PF-19–PF-20 are **NOT RUN as business scenarios**. PF-00–PF-14 and PF-21–PF-23 retain earlier grouped PASS evidence. PF-18's preceding actual failure and new test adjustments are not proof of an application defect or a current PASS.
- Post-group and final read-only preservation passed, with data/schema/privilege fingerprints matching baseline; no fixture manifests remained, invocation services stopped and ports were free. Run evidence: `.artifacts/playwright/posts/4804f2c9-0f1e-473e-9178-128814c00d28/run-summary.json`; resource evidence: `.artifacts/playwright/posts/resource-preflight/2026-10-28T16-14-10.726Z.json`. No screenshots or traces were captured; the existing config disables them for credential safety. No production code was changed. Step 5 remains BLOCKED.

## Targeted PF-18 and PF-21 retest — 2026-10-28 — INCOMPLETE

- Corrected PF-18's failed-refresh assertion to require the loaded cards remain unchanged, a list-specific error is visible, and retry restores the same content. This follows the documented ordinary-refresh draft-preservation behavior; confirmed 401 clearing remains separately tested. Corrected PF-21's editor locator to use the stable post-specific editor ID after opening edit mode, since edit mode replaces the content paragraph used by the original text-filtered locator. All validation/focus assertions remain.
- Strict standalone Playwright TypeScript, discovery-only listing (**5 tests / 1 file**) and `git diff --check` passed. Owner freshly confirmed exclusive `isn-test` access and no ISN-B Spark overlap. Two targeted groups ran serially with one worker and zero retries; no other group was repeated.
- `@concurrency-recovery` run `7ac1cf96-b17c-4d43-bb16-66f46f7db2e1`: **0/1 passed, 1 failed**. The revised refresh-preservation/error/retry assertions passed, as did subsequent load-more recovery checks. PF-18 then failed at `tests/e2e/specs/posts-feed.spec.ts:953`: on a deliberately aborted create, expected `Không thể kết nối`, actual `Chưa thể xác nhận kết quả đăng bài...` with no automatic retry and reconciliation prompt. `posts-api.ts:142–174` intentionally classifies fetch failure as `WRITE_OUTCOME_UNKNOWN`; `post-composer.tsx:69–107` requires Feed reconciliation and explicit confirmation before retry. The test's immediate-retry expectation conflicts with this implemented safety contract; no change or further retest was made. Draft, retry and uniqueness assertions after this failure and PF-19–PF-20 were not reached. PF-15–PF-17 steps preceded the failure without an earlier assertion failure but the report records only the combined test outcome.
- `@ux-compatibility` run `26a28f2b-857a-49d1-855f-2df0e51f3c34`: **1/1 passed, 0 skipped**, covering the combined PF-21–PF-23 test. Its real authenticated inspection covered Feed, detail, own/member profiles at **1440×900, 768×1024, 390×844 and 320×740**, plus editor validation, delete focus, reduced motion, keyboard, console/network checks, compatibility and cleanup step. Screenshots: `.artifacts/playwright/posts/26a28f2b-857a-49d1-855f-2df0e51f3c34/ui-inspection/`. This passing retest supports the locator correction but does not independently prove the previous timeout's cause.
- Each group passed fresh database preflight, resource gates and post-group exact cleanup/preservation; final data/schema/privilege fingerprints matched the original baseline, invocation services stopped and no unresolved manifests remained. Runtime paging warnings occurred in both groups while headroom stayed above the measured reserve. Summaries: `.artifacts/playwright/posts/7ac1cf96-b17c-4d43-bb16-66f46f7db2e1/run-summary.json` and `.artifacts/playwright/posts/26a28f2b-857a-49d1-855f-2df0e51f3c34/run-summary.json`. Failure screenshots/traces are disabled for credential safety.
- No production code was modified and no further retest was run. PF-00–PF-14 retain prior grouped PASS evidence, PF-18 remains FAIL at the later stale-contract assertion, PF-19–PF-20 remain NOT RUN, PF-21–PF-23 pass as a combined test; Step 5 is **INCOMPLETE**.

## Functional acceptance after test-infrastructure adjustment — 2026-10-28 — INCOMPLETE

- Adjusted the resource assessment to report three consecutive paging samples as a warning, not a standalone block; incomplete measurements, insufficient physical/commit headroom, unresolved workload inventory, active Docker/WSL/Spark, exact DB/ownership/cleanup gates remain blocking. Stage C raw samples are retained. This does not independently detect severe paging when headroom stays above reserve; warnings and actual stability remain a limitation, not a resource PASS guarantee.
- PF-14 now waits for the first 20 visible Feed cards before pagination, without weakening refresh/order/duplicate assertions. The runner's `--remaining` selects the three remaining groups and continues after a captured test failure only if the group checkpoint and resource checks succeed. **48/48** database-free Posts unit tests, strict standalone Playwright TypeScript, JS syntax checks and `git diff --check` passed before the real run.
- Owner confirmed exclusive `isn-test` access and no overlapping ISN-B Spark. Run `1495cb2b-0d7c-455d-a05d-88fb2a9d60d9`: one worker, zero retries; fresh DB preflight, Stage A/B/C and post-probe passed. Three tests executed: **1 PASS, 2 FAIL, 0 skipped**. PF-00–PF-08 remain two previously passed Playwright tests, not rerun.
- **PF-09–PF-14 PASS** as the combined visibility/feed test, including the synchronized PF-14 refresh/pagination assertions. The earlier PF-14 failure is not proven to have been caused by the race; this passing run is not proof of its prior root cause.
- **PF-15–PF-20 group FAIL at PF-18** (`tests/e2e/specs/posts-feed.spec.ts:859`): after a simulated aborted initial Feed refresh, test expected zero cards but observed three. PF-15–PF-17 were earlier steps reached without assertion failure; the report is group-level. PF-18 remaining checks and PF-19–PF-20 were not reached. Source `post-list.tsx:39,53–62` retains cards on ordinary refresh failure, consistent with the documented draft-preservation behavior; the zero-card assertion may be stale. The captured alert's identity and actual render details were not isolated, so this is not a confirmed application defect.
- **PF-21–PF-23 group FAIL at PF-21** (`tests/e2e/specs/posts-feed.spec.ts:1300`): after opening the editor and replacing its text with whitespace, clicking the save button via a card locator filtered by original post content timed out. Source `post-card.tsx:191–220` replaces the content paragraph with an editor when editing, so the locator can stop matching; this is a strong test-locator hypothesis, not confirmed runtime root cause. The subsequent edit-validation, delete-focus, reduced-motion, console/network and empty-state checks and PF-22–PF-23 steps were not reached. No production code was changed.
- The PF-21 viewport/page loop completed before that failure at **1440×900, 768×1024, 390×844, 320×740**, checking Feed, detail, own/member profiles, geometry and contrast; this is partial UI evidence, not a complete PF-21 PASS. Synthetic screenshots are in `.artifacts/playwright/posts/1495cb2b-0d7c-455d-a05d-88fb2a9d60d9/ui-inspection/`. Automatic failure screenshots/traces remain disabled for credential safety.
- Each group cleanup and post-group preflight passed; invocation services stopped and final read-only data/schema/privilege fingerprints matched baseline, with no unresolved manifests. Paging warnings occurred in the first two groups with headroom above reserve; no paging warning in the last. Sanitized run summary: `.artifacts/playwright/posts/1495cb2b-0d7c-455d-a05d-88fb2a9d60d9/run-summary.json`. No retest was run after failures. Step 5 is **INCOMPLETE**, not PASS.

## Functional acceptance continuation — 2026-10-28 — BLOCKED before Playwright tests

- Owner freshly confirmed exclusive `isn-test` access and no overlapping ISN-B Spark. The focused `npm run test:e2e:posts -- --group @visibility-feed` invocation passed fresh read-only V1–V5 preflight, Stage A and Stage B, but stopped at Stage C before running any Playwright business test or creating scenario fixtures. Spark was not detected and Docker/WSL inventories were verified empty.
- Stage C sampled paging in **3/3 consecutive samples**, causing the existing readiness policy to return `safe=false`. Minimum physical/commit headroom was **1,853,370,368 / 7,775,178,752 bytes**, compared with measured reserves **847,347,712 / 1,285,369,856 bytes**. This is a failed resource gate, not proof that paging caused the earlier PF-14 failure or that all testing is impossible. No policy was changed and no retry was attempted.
- Final read-only preservation preflight passed after the runner stopped invocation services: data, schema and privilege fingerprints matched the initial values, free ports and unresolved fixture-manifest checks passed. No Playwright business test executed, so the prior PF ledger and incomplete disposition remain unchanged. No screenshot or trace was captured.
- Evidence: `.artifacts/playwright/posts/87a189da-b5bf-45b5-b65c-76a195f9f9c8/run-summary.json` and `.artifacts/playwright/posts/resource-preflight/2026-10-28T15-13-52.494Z.json`.
- Source assessment of PF-14: the fixture creates more than a page of visible posts and the preceding PF-12 waits for the first 20 cards before pagination, consistent with the documented page size. PF-14 instead calls `loadAllPostPages` immediately after navigation; the helper performs an immediate button count while `PostList` fetches its first page asynchronously. This demonstrates a possible synchronization weakness, but the previous observed zero cards cannot be conclusively attributed to it without a successful diagnostic run. No test assertion or production code was changed.

## Focused acceptance continuation — 2026-10-28 — INCOMPLETE/BLOCKED

- Owner confirmed exclusive `isn-test` access for the test and cleanup and stated ISN-B Spark was paused. The existing runner used one worker, zero retries, fresh read-only V1–V5 database preflight and Stage A/B/C resource readiness; the initial gates passed and Spark was not detected. Docker/WSL inventories showed zero workloads.
- Ran `npm run test:e2e:posts -- --group @visibility-feed` once: **0 passed / 1 failed / 0 skipped** Playwright tests. The serial test reached PF-14 after PF-09–PF-13 steps without an earlier assertion failure, but the saved report provides only the combined test result, not independent per-step outcomes. At `tests/e2e/specs/posts-feed.spec.ts:587`, PF-14 expected more than 20 `.post-card-content` elements after navigating to `/bang-tin` and loading pages; `allTextContents()` returned 0. The subsequent PF-14 assertions were not reached. Root cause is **unconfirmed**: `loadAllPostPages` checks for the load-more button immediately, so initial asynchronous loading is a possible test race, but the saved evidence does not establish that rather than an application/environment failure. No fix was made.
- The runtime resource assessment found **three consecutive paging samples** (`safe=false`, `checks=1`); minimum available physical memory **2,420,146,176 bytes**, commit headroom **8,588,021,760 bytes**. Because resource readiness failed, no retry or further groups were run. PF-15–PF-23 and all four authenticated viewport inspections are **NOT RUN**. PF-00–PF-08 retain their prior grouped PASS evidence, not a new run.
- Post-group cleanup and final preservation passed; initial and final data, schema and privilege fingerprints matched (`0e86ee7f2c92de4a578ffcbe82da05ce5a742ffaa139864cf1507619dfce8bd4`, `54e0c56b98e0caf9b7d6b4aa32ddd81a6ee748bd722155fdca8edf8f54683b1d`, `e35e491875f170d57913e74eba7257c4c7356dafbe1e65a2e900642cd5633645`). The runner stopped invocation services and its final preflight verified free ports and no unresolved fixture manifests.
- Sanitized failure and resource evidence: `.artifacts/playwright/posts/7adaf14a-46f8-4871-a2eb-5c5de624665d/run-summary.json` and `.artifacts/playwright/posts/resource-preflight/2026-10-28T15-00-22.445Z.json`. Existing configuration disables automatic screenshots/traces for credential safety; no failure screenshot or trace was captured. No new fixtures, product code, or test assertions were changed.

## One final authorized Playwright acceptance — 2026-10-16 — BLOCKED

- **Authorization and safety:** The Project Owner confirmed the exclusive `isn-test` write window and no overlapping ISN-B Spark workload. The standard `npm run test:e2e:posts` path passed the fresh read-only preflight and Stage A/B/C resource gates before starting Playwright. It used one worker and zero retries; no harness or scenario changes were made.
- **Target and database:** Branch `feature/posts-feed`, expected pre-commit HEAD `07b9b385321716a514ecef99ff0184e8f903fac2`. Restricted principal `isn_test_runner`; exact `isn-test` database ID `336953E435C22F87EF53AAF1A42024422029E9ECB305B7108694A6EEDC37A786`; V1–V5 verified, 12 constraints, 18 indexes, `isn-dev` denied, zero active transactions, and no unresolved fixture manifests.
- **Playwright result:** Run `e6b53db2-c852-4048-8321-6c46b47e6c04`. Group `@lifecycle-security` completed **2/2 expected, 0 skipped, 0 unexpected, 0 flaky**; Playwright process exit code 0. The overall group/acceptance disposition is **BLOCKED**, not PASS: the runtime resource assessment reported `Paging activity persisted across three consecutive samples` (`sampleCount=3`, `checks=1`, `sustainedPaging=true`). The remaining groups `@visibility-feed`, `@concurrency-recovery`, and `@ux-compatibility` were not run. Runner exit code: 1. No product assertion failed in the executed tests.
- **Resource evidence:** Stage A passed 6 samples (minimum physical/commit headroom **4,884,684,800 / 5,659,508,736 bytes**, no paging); Spark absent and Docker/WSL inventories verified with zero workloads. Stage B passed with observed physical/commit demand **212,975,616 / 385,433,600 bytes**. Stage C passed with four browser contexts/five pages and measured peak demand **990,408,704 / 1,292,488,704 bytes**; no sustained paging. During the Playwright group, the runtime monitor recorded minimum physical/commit headroom **3,610,607,616 / 3,872,538,624 bytes**, but paging persisted across three consecutive samples. Stage A evidence: `.artifacts/playwright/posts/resource-preflight/2026-10-15T17-03-07.076Z.json`; sanitized run summary: `.artifacts/playwright/posts/e6b53db2-c852-4048-8321-6c46b47e6c04/run-summary.json`.

| PF | Result | PF | Result | PF | Result |
|---|---|---|---|---|---|
| PF-00 | PASS | PF-08 | PASS* | PF-16 | NOT RUN |
| PF-01 | PASS* | PF-09 | NOT RUN | PF-17 | NOT RUN |
| PF-02 | PASS* | PF-10 | NOT RUN | PF-18 | NOT RUN |
| PF-03 | PASS* | PF-11 | NOT RUN | PF-19 | NOT RUN |
| PF-04 | PASS* | PF-12 | NOT RUN | PF-20 | NOT RUN |
| PF-05 | PASS* | PF-13 | NOT RUN | PF-21 | NOT RUN |
| PF-06 | PASS* | PF-14 | NOT RUN | PF-22 | NOT RUN |
| PF-07 | PASS* | PF-15 | NOT RUN | PF-23 | NOT RUN |

\* PF-01–PF-08 are assertions within one combined Playwright test; the report records the combined test result, not independent counts for each assertion. PF-23 was not executed as a scenario; the separate final preservation check passed.

- **Authenticated browser UX:** Real Chromium → React/Vite → NestJS → `isn-test` authenticated journeys and Post lifecycle assertions in PF-01–PF-08 passed. PF-21 did not run: authenticated screen inspection, screenshots, keyboard/accessibility and console/network checks at **1440×900, 768×1024, 390×844, and 320×740** are **NOT RUN**. Stage C's resource probe is not authenticated UI evidence.
- **Cleanup/preservation:** Group 1 exact fixture cleanup and post-group preflight passed. Final read-only preflight passed after invocation-owned services stopped; initial/final data fingerprint `0e86ee7f2c92de4a578ffcbe82da05ce5a742ffaa139864cf1507619dfce8bd4`, schema fingerprint `54e0c56b98e0caf9b7d6b4aa32ddd81a6ee748bd722155fdca8edf8f54683b1d`, and privilege fingerprint `e35e491875f170d57913e74eba7257c4c7356dafbe1e65a2e900642cd5633645` matched. No recovery manifests remained; ports 3312/5182 were free. No migration, provisioning, or `isn-dev` access occurred.
- **Disposition:** Stop after this single acceptance execution. Do not retry or run the unexecuted groups. Step 5 remains **BLOCKED** because runtime resource readiness did not remain safe, even though executed Playwright assertions passed and database preservation succeeded.

## Previous bounded E2E invocation — 2026-10-15 — BLOCKED

- **Authorization:** The Project Owner authorized this one final bounded attempt, including the approved scenario writes and cleanup. The current Stage A gate independently verified no Spark workload; the authorization is consumed and no further acceptance run was started.
- **Target:** Worktree `D:\DoAn\BigData\isn-worktrees\posts-feed`, branch `feature/posts-feed`, expected HEAD `07b9b385321716a514ecef99ff0184e8f903fac2`. The guarded target check passed.
- **Fresh database preflight:** **PASS, read-only.** Database `isn-test`, ID `336953E435C22F87EF53AAF1A42024422029E9ECB305B7108694A6EEDC37A786`; V1–V5 checksums/history and schema marker; 12 constraints, 18 indexes; restricted `isn_test_runner` principal and approved 14 Post/AUTHORED grants; `isn-dev` denied; zero active `isn-test` transactions; no unresolved ownership manifests. Ports 3312/5182 were free before startup.
- **Measured resources:** Stage A passed six samples: minimum available physical memory **3,221,610,496 bytes**, commit headroom **4,909,334,528 bytes**, no paging; Spark absent, two local Neo4j Java processes, Docker/WSL inventories verified with zero workloads. Stage B passed with observed demand **54,841,344 physical / 339,312,640 commit bytes** and a complete four-process API/Web tree. Stage C passed the four-context/five-page browser capacity probe with measured peak demand **937,877,504 physical / 1,400,725,504 commit bytes**, no paging; post-probe headroom remained above measured demand. Evidence: `.artifacts/playwright/posts/resource-preflight/2026-10-15T15-30-55.302Z.json` and the run summary below.
- **Playwright execution:** Run `556ace7c-6387-420d-8140-6b56e26f114a`; one worker, zero retries. `@lifecycle-security` ran **2 tests: 2 expected/pass, 0 skipped, 0 unexpected, 0 flaky**, process exit code 0. The group disposition is **BLOCKED**, not PASS: runtime monitor `checks=0`, `safe=false`, issue `No runtime resource sample completed during the Playwright group.` The runner stopped serial execution before `@visibility-feed`, `@concurrency-recovery`, and `@ux-compatibility`. Preserved summary: `.artifacts/playwright/posts/556ace7c-6387-420d-8140-6b56e26f114a/run-summary.json`.
- **PF-00–PF-23 results:** PF-00 and the grouped PF-01–PF-08 assertions **PASS** in the two completed Playwright tests. PF-09–PF-23 are **NOT RUN** in this invocation. The aggregate report does not provide independent per-assertion counts within PF-01–PF-08.

| PF ID | Result | PF ID | Result | PF ID | Result |
|---|---|---|---|---|---|
| PF-00 | PASS | PF-08 | PASS* | PF-16 | NOT RUN |
| PF-01 | PASS* | PF-09 | NOT RUN | PF-17 | NOT RUN |
| PF-02 | PASS* | PF-10 | NOT RUN | PF-18 | NOT RUN |
| PF-03 | PASS* | PF-11 | NOT RUN | PF-19 | NOT RUN |
| PF-04 | PASS* | PF-12 | NOT RUN | PF-20 | NOT RUN |
| PF-05 | PASS* | PF-13 | NOT RUN | PF-21 | NOT RUN |
| PF-06 | PASS* | PF-14 | NOT RUN | PF-22 | NOT RUN |
| PF-07 | PASS* | PF-15 | NOT RUN | PF-23 | NOT RUN |

\* PASS is the result of the combined PF-01–PF-08 Playwright test; it does not mean the aggregate report isolated each assertion.

- **Authenticated UI/UX:** PF-21 did not run. No authenticated responsive inspection or screenshot was produced. **1440×900, 768×1024, 390×844 and 320×740**, keyboard/focus, validation, reduced motion, console and network checks are **NOT RUN**. Stage C was a resource probe only.
- **Defects/correction:** No product defect was observed. The prior launcher's artifact had no captured stack; source inspection found `runPlaywrightGroup()` referenced `services` outside its `main()` scope, which throws before group reporting. Service PIDs are now passed explicitly; sanitized runner/child diagnostics and exit status are retained. Focused runner tests passed **13/13**. No repeat E2E was attempted after the runtime-monitor block.
- **Cleanup/preservation:** First-group post-check and final preservation both passed. The baseline data fingerprint remained `0e86ee7f2c92de4a578ffcbe82da05ce5a742ffaa139864cf1507619dfce8bd4`, schema fingerprint `54e0c56b98e0caf9b7d6b4aa32ddd81a6ee748bd722155fdca8edf8f54683b1d`, and privilege fingerprint `e35e491875f170d57913e74eba7257c4c7356dafbe1e65a2e900642cd5633645`. No recovery manifests remain. The runner reports first-group fixture cleanup PASS; invocation-owned API/Web/browser processes stopped, ports 3312/5182 are free, and invocation temp/auth-key/marker paths were removed. The sanitized run summary and Stage A evidence remain under ignored `.artifacts/`. No ISN-A, ISN-B workload or `isn-dev` data was modified.
- **Disposition boundary:** This final authorization is consumed. No further acceptance execution is authorized here; stop for Technical Adviser and Owner review. Steps 6–7 did not start.
- **Git state:** Branch `feature/posts-feed`, HEAD `07b9b385321716a514ecef99ff0184e8f903fac2`; index clean. Existing implementation and documentation changes remain unstaged and uncommitted.

## Final closure summary

- **Scope frozen:** PF-00–PF-23 only; existing four serial groups retained. No new scenario group or test framework was introduced.
- **MCP:** Authenticated MCP was not run. The Owner-approved Playwright Test substitute is implemented in PF-21, but it was among the groups not reached; no authenticated four-viewport evidence or MCP PASS is claimed.
- **Technical work:** Missing source assertions were completed; a failing web regression exposed and fixed missing `aria-invalid`/error-description linkage for Post edit validation. An isolated HTTP test now verifies an incomplete V4 schema returns `/ready` HTTP 503 without connecting to or modifying Neo4j. Real-stack V5-ready verification remains in the guarded PF-00/PF-22 paths.
- **Verification:** Workspace tests: 177 API and 80 Web passed; API health/readiness HTTP tests 3/3 passed; Posts Playwright TypeScript and discovery passed (5 tests found); typecheck and build passed. Historical resource-only Stage A/B/C PASS is preserved; it does not measure final Playwright worker demand.
- **Database/cleanup:** The latest attempt performed fresh read-only identity/schema/grant/baseline preflight and final preservation comparison. The first group's exact fixture cleanup and baseline check passed; no fixture recovery manifest remains.
- **Remaining gate:** The first group's runtime resource monitor completed zero samples before the group ended, so the runner failed closed and stopped the remaining groups. This authorization is consumed; no repeat run is initiated. Step 5 is not ready for Technical Adviser review.

## Authorization and safety gates

| Gate | Status | Evidence |
|---|---|---|
| Exclusive `isn-test` use | **PASS — current bounded authorization used once** | The Owner authorized this final bounded run, including fixture writes and cleanup; no authorization remains for a retry. |
| ISN-B workload clearance | **PASS — fresh Stage A verified no Spark** | Current inventory observed no Spark, no unknown Java workload, and verified zero Docker/WSL workloads. |
| Execution target/resources | **Preflight PASS; group disposition BLOCKED** | Target and Stage A/B/C passed. Group 1's runtime monitor had zero completed checks, so the runner stopped serial execution; ports are now free. |
| Live V5 preflight | **PASS — current invocation** | Read-only guard verified the expected `isn-test` identity, V1–V5 history/schema, 12 constraints, 18 indexes, restricted principal/grants, denied `isn-dev`, zero active transactions and preserved baseline before writes. Final fingerprints match. |
| Migration/provision/reset | **NOT RUN** | No migration, provisioning, grant, reset, or `test:neo4j` umbrella command was used during Step 5. |

## Prior guarded Playwright Test outcomes

Final full guarded run: **`a2a1e09b-b4a4-4016-8148-55c6dbc93ad2`**. Sanitized run summary is retained under the ignored `.artifacts/playwright/posts/` directory.

| Group | Test-step scope | Playwright Test result |
|---|---|---|
| `@lifecycle-security` | PF-00–PF-08 | **PASS** — 2/2 Playwright tests; real authentication, security boundaries, Post lifecycle and runtime readiness. |
| `@visibility-feed` | PF-09–PF-14 | **PASS** — 1/1; current friendship visibility, privacy-safe lists and real cursor/UI pagination. |
| `@concurrency-recovery` | PF-15–PF-20 | **PASS** — 1/1; overlapping mutations, separate stale recovery, session revocation/controlled expiry and recovery journeys. |
| `@ux-compatibility` | PF-21–PF-23 | **PASS** — 1/1; four required viewport sizes, keyboard/focus, reduced motion, compatibility and cleanup checks. |

These are grouped test execution results, not a blanket PASS for every subassertion in the PF ranges; see the per-ID audit below.

All five Playwright tests passed with no skips, retries, flaky or unexpected outcomes. Success paths used the real Chromium → React → Vite → NestJS → `isn-test` stack. PF-18/PF-19 fault injection is explicitly **SIMULATED** with real recovery; PF-20 is controlled delayed delivery, not a claim of an actual ambiguous Neo4j commit. PF-17 expiry was a scoped update to the exact owned test session, not elapsed-time evidence.

## PF-00–PF-23 evidence-ledger audit

The table distinguishes historical execution from this final bounded run. PF-00 and PF-01–PF-08 passed within the two reported tests; the aggregate report does not isolate each assertion. PF-09–PF-23 were not reached after the runner stopped on its zero-sample runtime monitor. Interactive MCP is separate from Playwright Test evidence.

| ID | Historical execution | Current assertion/evidence status |
|---|---|---|
| PF-00 | Historical REAL-DB + REAL-E2E **PASS** | **PASS** — fresh restricted V5 preflight and real `/health` + `/ready` browser check. |
| PF-01 | Historical grouped test **PASS** for prior assertions | **PASS in grouped PF-01–PF-08 test** — anonymous Feed/detail redirects, no protected flash and API 401 checks. |
| PF-02 | Historical REAL-API + REAL-DB **PASS** | **PASS in grouped test** — CSRF/Origin/Fetch-Metadata/Referer rejection, no-mutation and trusted Referer fallback. |
| PF-03 | Historical grouped test **PASS** for prior assertions | **PASS in grouped test** — malformed `expectedVersion` sent without DELETE body and returns 422. |
| PF-04 | Historical REAL-E2E + REAL-API **PASS** | **PASS in grouped test** — visible member Post/non-owner 403 versus hidden/missing privacy 404 and no owner controls. |
| PF-05 | Historical grouped test **PASS** for prior assertions | **PASS in grouped test** — create timestamps and successful composer draft clearing. |
| PF-06 | Historical REAL-E2E + REAL-API **PASS** | **PASS in grouped test** — Members visibility, version increment, update, immutable visibility/createdAt and member read. |
| PF-07 | Historical REAL-E2E + REAL-API + REAL-DB **PASS** | **PASS in grouped test** — content boundary, Unicode normalization/control and literal text assertions. |
| PF-08 | Historical REAL-E2E + REAL-API + REAL-DB **PASS** | **PASS in grouped test** — confirmation/cancel focus, deletion, repeat 404, DB absence and stale-delete conflict. |
| PF-09 | Historical REAL-E2E + REAL-API + REAL-DB **PASS** | **NOT RUN** — pending-viewer cursor oracle and cross-viewer cursor rejection. |
| PF-10 | Historical REAL-E2E + REAL-API + REAL-DB **PASS** | **NOT RUN** — unfriend visibility/cache invalidation and re-friend with new Friendship ID. |
| PF-11 | Historical API source coverage **PARTIAL** | **NOT RUN** — owner/accepted-friend/stranger profile cursor role matrix. |
| PF-12 | Historical REAL-E2E + REAL-DB **PASS** | **NOT RUN** — owned Posts, independent feed/profile oracle, pagination and equal-timestamp UUID order. |
| PF-13 | Historical API source coverage **PARTIAL** | **NOT RUN** — deleted-anchor continuation IDs/order and anchor absence. |
| PF-14 | Historical REAL-E2E + REAL-API **PARTIAL** | **NOT RUN** — create-after-pagination and refresh/full-order/no-duplicate checks. |
| PF-15 | Historical REAL-E2E + REAL-API **PARTIAL** | **NOT RUN** — overlapping mutations and final API/DB/UI reconciliation. |
| PF-16 | Historical REAL-E2E + REAL-API **PASS** | **NOT RUN** — stale conflict, retained draft, explicit reload and retry. |
| PF-17 | Historical REAL-E2E + REAL-DB **PARTIAL** | **NOT RUN** — exact-session expiry redirect and protected-card clearing. |
| PF-18 | Historical SIMULATED + REAL-E2E + REAL-API **PASS** | **NOT RUN** — approved simulated aborted writes and real retry recovery. |
| PF-19 | Historical SIMULATED + REAL-E2E + REAL-DB **PASS** | **NOT RUN** — suppressed committed create and controlled unknown-outcome reconciliation. |
| PF-20 | Historical REAL-E2E + CONTROLLED DELIVERY **PARTIAL** | **NOT RUN** — delayed responses across deletion/unfriend and route/profile changes. |
| PF-21 | Historical automated checks **PARTIAL; MCP NOT RUN** | **NOT RUN** — authenticated UI substitute, four viewports, keyboard/ARIA, screenshots, console/network and reduced motion. |
| PF-22 | Historical REAL-E2E + REAL-API **PARTIAL** | **NOT RUN** — Friendship rejection and scenario-specific V5 compatibility assertion; isolated fake-dependency readiness test remains **PASSED 1/1**. |
| PF-23 | Historical REAL-DB cleanup/preservation **PASS** | **NOT RUN as a PF scenario**; final guarded preservation fingerprints matched, and PF-01–PF-08 cleanup/preflight passed. |

This invocation proves only the reported PF-00 and grouped PF-01–PF-08 test assertions. PF-09–PF-23 remain unverified in the current run; historical execution does not substitute for them.

## Earlier bounded Playwright MCP inspection

While the guarded invocation-owned services were active, MCP navigated anonymously to `/ho-so`; the real application redirected to `/dang-nhap?returnTo=%2Fho-so` and issued only `GET /api/auth/session` requests, which correctly returned 401 for the anonymous context. No credentials were entered and no writes were made. The inspected login page rendered at 1280×838 and 390×844; the 390-pixel document had no horizontal overflow. Keyboard Tab exposed the “Đi đến biểu mẫu” skip link with a visible focus outline. The only browser console error entries were the expected anonymous 401 resource responses; there were no warnings. Local screenshots: `.playwright-mcp/page-2026-10-15T09-02-27-077Z.png` (mobile full page) and `.playwright-mcp/page-2026-10-15T09-02-41-006Z.png` (keyboard focus). Authenticated synthetic journeys were exercised by the guarded Chromium acceptance suite, not by sharing credentials with MCP.

## Earlier authenticated MCP continuation — BLOCKED; authorization not renewed

- The Project Owner explicitly authorized a fresh exclusive `isn-test` window for this bounded invocation and confirmed ISN-B would not overlap. The guarded read-only preflight passed: database ID `336953E435C22F87EF53AAF1A42024422029E9ECB305B7108694A6EEDC37A786`; V1–V5 current; 12 constraints, 18 indexes, 14 restricted Post/AUTHORED grants; `isn-dev` denied; zero active test transactions and no unresolved fixture ownership manifests. Data, schema and privilege fingerprints matched the recorded baseline. No writes were performed.
- The dedicated ports were free and the Spark-process probe found none. A subsequent conservative resource check reported only **1.72 GiB** available from both Node and Windows, below the required 4 GiB floor. No API/Vite service or fixture setup was started after that check.
- No Posts-specific protected temporary-input/credential handoff exists in the inspected repository. The available MCP form/type tools take field text as tool arguments; using them for a password would place the secret in the tool-call transcript. No credentials were sent, entered or persisted, and no authentication bypass or new handoff infrastructure was introduced.
- The existing anonymous MCP tab was closed. This continuation created no account, session, Post, Friendship, key, interception, listener or process; there was therefore no invocation-owned database fixture to clean up. The authenticated Feed/detail/profile/editor/delete inspection, four authenticated viewport observations and authenticated console/network review remain **NOT RUN / BLOCKED**.
- Two residual Posts runner-control marker files had no live owning PID; they were left untouched. They are not fixture ownership manifests, and no acceptance listener was present.
- `isn-dev`, ISN-A and ISN-B were not accessed or modified. ISN-B clearance was only confirmed; the process probe found no Spark workload.

## Resource diagnosis and non-writing startup probe — 2026-10-15 — PASS (limited probe); Step 5 BLOCKED

- **Root cause of the old threshold:** `2,632,237,056` estimated physical bytes were calculated as the largest *global* Node working set ×2 plus the largest *global* browser working set ×4; the combined estimate was then doubled to **5,264,474,112 bytes**. Commit demand used the same assumptions. These are workload-count multipliers, not measured ISN-C peaks. Arithmetic remained in bytes—there was no GB/GiB conversion inside the formula. The OS available-memory counter already reflects all running processes; the gate did not subtract those process measurements a second time, but it did reuse unrelated global Node/browser maxima as an additional future-workload reserve. The formula never separately summed Playwright Test and MCP, but an already-open MCP Chrome process could supply the global browser maximum despite their serial lifecycles.
- The earlier six-sample Stage A observation remains historical: minimum available memory **4,034,654,208 bytes**, commit headroom **5,268,176,896 bytes**, and one transient paging sample. Against the former estimate, physical memory was short **1,229,819,904 bytes** while commit headroom exceeded its estimate by **318,095,360 bytes**. A later three-sample read-only observation found **16,886,128,640 bytes** total physical RAM, **5,916,999,680–6,543,208,448 bytes** available and **5,385,945,088–5,473,640,448 bytes** commit headroom, with zero paging counters in those short samples. This does not demonstrate persistent physical-memory insufficiency.
- **Final resource policy:** Stage A records six 10-second system samples and fails on incomplete samples, sustained paging, exhausted physical/commit capacity, unknown Spark state, incomplete Docker/WSL inventory, or any reported active Docker/WSL workload. It does not forecast demand from unrelated processes. The collector no longer reads process command lines. It classifies local Neo4j Java processes through the Java listener on ports 7474/7687 and its process ancestors; unrelated Java remains unclassified/fail-closed. Owned process trees use explicit byte-valued `WorkingSet64` and `PrivateMemorySize64` measurements. Runtime reserve is the measured Stage-A-to-stage reduction in system-wide available physical/commit headroom, avoiding assumed multipliers and summing shared working-set pages. Microsoft Learn documents [`PrivateMemorySize64`](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.privatememorysize64?view=net-10.0) in bytes; on sampled PIDs it matched the prior `PrivatePageCount` output. Node's [`os.tmpdir()`](https://nodejs.org/docs/latest-v24.x/api/os.html#ostmpdir) documentation confirms Windows `TEMP`/`TMP` overrides; new temp/profile paths are invocation-local under ignored worktree `.artifacts/.../tmp`, checked in-worktree and Git-ignored before creation.
- **Earlier probe-only attempts:** `.artifacts/playwright/posts/ebfd924a-8fec-4b52-a51d-9692bcc58414/run-summary.json` and `.artifacts/playwright/posts/83ff3454-7300-4ab0-a4a7-add2fa13f29f/run-summary.json`. Both used dummy DB settings and an unreachable loopback Neo4j endpoint; neither ran DB preflight, fixtures, migrations, provisioning or business tests. Stage A/B passed and Stage C navigated the login page with four contexts/five pages and measured owned process trees, but Stage C reported Docker/WSL unavailable. Root cause was a harness restriction: Stage C reran those checks in a child environment that intentionally omitted Docker/WSL configuration. The correction reuses Stage B's immediately preceding verified inventory while Stage C still samples machine memory and Spark/Java state. No credentials or configuration values were transferred to the child.
- **Earlier resource-only invocation PASS:** `003506ff-8800-4031-95f9-5dbe50e69412`. Its results are retained in `.artifacts/playwright/posts/003506ff-8800-4031-95f9-5dbe50e69412/run-summary.json`; it predated the active Docker/WSL workload-count regression.
- **Latest resource-only invocation PASS after enforcing zero active Docker/WSL workloads:** `abd6a9c3-9f62-4a3b-a8bb-63b1acd66f5c`. Stage A minimum available physical/commit headroom: **4,066,856,960 / 4,951,756,800 bytes**; one isolated paging sample, no sustained paging. Docker and WSL inventories were verified with **zero** active workloads; Spark was not detected, and two Java processes were classified in the local Neo4j listener/ancestor family. Stage B measured Stage-A-to-B headroom reduction: **208,338,944 physical / 862,142,464 commit bytes**; the owned API/Web tree measured **472,240,128 working-set / 977,248,256 private bytes**. Stage C used **four contexts/five pages**; measured Stage-A-to-C headroom reduction was **973,242,368 physical / 1,629,454,336 commit bytes**, while Stage C retained **3,093,614,592 physical / 3,322,302,464 commit bytes**. The browser-owned tree measured **1,435,729,920 working-set / 807,591,936 private bytes**; one paging sample was transient, not sustained. Post-probe headroom after browser close was **3,939,753,984 / 4,293,959,680 bytes** and remained above the measured reserve. The existing built API, one Vite process and browser were stopped; invocation-owned keys and temp/profile files were removed, and ports 3312/5182 were free afterward. This probe did not connect to Neo4j, measure a Playwright Test worker, or execute a business journey. Summary: `.artifacts/playwright/posts/abd6a9c3-9f62-4a3b-a8bb-63b1acd66f5c/run-summary.json`; Stage A evidence: `.artifacts/playwright/posts/resource-preflight/2026-10-15T14-03-59.361Z.json`.
- Read-only process-name/working-set observations found multiple Node/Chrome/OpenCode processes, two Java processes and a Docker backend; no command lines or environment values were collected. The Java listener check showed PID 35784 listening on the local Neo4j ports with PID 35064 as its parent. Docker/WSL inventory reported zero workloads in both resource-only probes. The physical-memory dip was transient and the final measured probe retained headroom; this hardware did not show a persistent capacity limit for the bounded runtime. Disk was not inspected or changed; there is no evidence disk space caused RAM pressure.
- The installed Playwright MCP tool catalog offers direct text-entry arguments, page evaluation and an RCE-equivalent arbitrary runner. MCP resources expose no additional mechanism or version string; no storage-state import or protected secret substitution is available in the exposed tools. Supplying a password through text-entry arguments would expose it in the tool transcript. No credential was sent. Authenticated MCP remains **NOT RUN / BLOCKED**.

## Current assertion completion and acceptance limitation

- The saved Playwright spec contains executable assertions for every source gap in the prior audit, including Friendship rejection, current role-specific profile cursors, expected deleted-anchor continuation IDs, creation after Feed pagination, race/UI/DB reconciliation, post-expiry protected-state clearing, stale-response protection, reduced-motion timings/scroll behavior, and authenticated PF-21 inspection. PF-21 screenshot capture is limited to synthetic authenticated screens under the guarded invocation's ignored `.artifacts/playwright/posts/<runId>/ui-inspection/` directory.
- The edit-validation regression initially failed because the editor did not expose `aria-invalid` or associate its alert with the field. The minimal UI fix and component regression now pass. PF-22's incomplete-V5 `/ready` rejection has a controlled isolated HTTP test returning 503 for migration version 4; it uses a fake migration status and no database connection. The guarded PF-00/PF-22 path retains the separate real-stack V5 readiness check.
- These current Playwright assertions have **NOT RUN** against `isn-test`; the historical 5/5 run does not retroactively prove them. The Owner-approved real Playwright Test substitution for authenticated MCP is implemented but has not produced browser evidence. No guarded business group or database-backed test ran in this closure.
- The historical run `a2a1e09b-b4a4-4016-8148-55c6dbc93ad2` and its 5/5 result, cleanup, and preservation evidence remain unchanged historical evidence. Newly added assertions and resource measurements do not retroactively upgrade that run.

## Historical cleanup and preservation

Every group’s post-group cleanup/preservation gate passed. Final read-only preflight also passed with zero unresolved Posts manifests and zero active `isn-test` transactions. Initial and final application-data fingerprints matched exactly: `0e86ee7f2c92de4a578ffcbe82da05ce5a742ffaa139864cf1507619dfce8bd4` (0 users, 0 sessions, 2 auth events, 0 pairs, 0 friendships, 0 Posts, 0 AUTHORED). Schema fingerprint remained `54e0c56b98e0caf9b7d6b4aa32ddd81a6ee748bd722155fdca8edf8f54683b1d`; restricted-privilege fingerprint remained `e35e491875f170d57913e74eba7257c4c7356dafbe1e65a2e900642cd5633645`.

During the historical acceptance convergence, failed attempts left durable ownership manifests. The guarded runner blocked retries; each manifest was matched to the approved database and exact synthetic owners, then the existing ownership-aware recovery cleanup verified and restored the recorded baseline. No unresolved manifest remains. That historical final complete run does not cover the current assertion additions.

## Previous database-free verification (historical)

| Command | Result |
|---|---|
| Focused Posts safety/ownership tests (`node --test --test-concurrency=1 ...`) | **27/27 passed**. |
| `npm test` | **25 API suites / 177 tests; 17 Web files / 77 tests passed**. |
| `npm run test:api:e2e` | **2 suites / 12 tests passed**. |
| `npm run typecheck` / `npm run build` | **Passed**. |
| `npm run test:integration` | **1/1 passed**; HTTP integration only, not DB acceptance evidence. |
| `npm run test:e2e:posts:list` | **5 tests discovered** through list-only mode. |
| `git diff --check` | **Passed**. |

## Resource diagnosis verification — 2026-10-15 (historical)

| Check | Result |
|---|---|
| Posts helper/ownership/preflight/runner unit tests (five files) | **40/40 passed**. |
| Workspace unit tests (`npm test`) | **25 API suites / 177 tests; 17 Web files / 79 tests passed**. |
| API HTTP contract suite (`npm run test:api:e2e`) | **2 suites / 12 tests passed**. |
| `npm run typecheck` and `npm run build` | **Passed**. |
| Root HTTP integration (`npm run test:integration`) | **1/1 passed**; no Neo4j acceptance. |
| Strict standalone TypeScript check of Posts Playwright config/spec | **Passed**. |
| `npm run test:e2e:posts:list` | **5 tests discovered**; list-only, no scenario execution. |
| Resource-only probe `abd6a9c3-9f62-4a3b-a8bb-63b1acd66f5c` | **PASS**; no database access or PF business group. |
| Runner/probe/resource JavaScript syntax checks and `git diff --check` | **Passed**. |

No guarded Posts acceptance group, live V5 preflight, database-backed test, or authenticated MCP inspection ran in this continuation. The resource-only probe is not final acceptance evidence.

## Final closure Build verification — 2026-10-15

| Check | Result |
|---|---|
| PostCard focused UI regression | **6/6 passed**; includes the new accessible editor-validation assertion. |
| Workspace unit tests (`npm test`) | **25 API suites / 177 tests; 17 Web files / 80 tests passed**. |
| Isolated readiness HTTP contract (`npm run test:api:e2e -- --runTestsByPath test/health.e2e-spec.ts`) | **3/3 passed**; includes real controller/service V4→V5 rejection mapping with fake dependencies and no database connection. |
| Neo4j schema-service unit tests | **8/8 passed**. |
| `npm run typecheck` / `npm run build` | **Passed**. |
| Strict standalone Posts Playwright config/spec TypeScript check | **Passed**. |
| `npm run test:e2e:posts:list` | **5 tests discovered**; list-only, no service or fixture startup. |
| Posts safety/ownership/resource helper tests | Existing **40/40** result retained; these utilities were unchanged in this closure. |
| Root HTTP integration | Existing **1/1** result retained; proxy/runtime behavior was unchanged. |
| JavaScript syntax checks and `git diff --check` | **Passed** after final edits. |

No guarded V5 preflight, Playwright business group, authenticated browser journey, screenshot, fixture setup/cleanup, or final preservation comparison ran during this closure. The bounded resource-only Stage A/B/C PASS remains historical, does not measure the Playwright Test worker/screenshots, and does not replace current resource sampling inside the authorized final runner.

## Repository state and handoff

Branch/HEAD are unchanged (`feature/posts-feed` / `07b9b385321716a514ecef99ff0184e8f903fac2`); the index remains empty. Existing Step 4 work is preserved, and all changes remain unstaged/uncommitted. No branch, commit, push, PR, or merge occurred. `isn-dev`, ISN-A, and ISN-B were not accessed or modified. No database endpoint or credential was used by the isolated readiness contract.

**Next action:** No further acceptance attempt is authorized. Preserve the blocked Step 5 disposition and stop for Technical Adviser review and an explicit Project Owner decision. Do not connect to Neo4j, run a Playwright business group, or begin Step 6 Independent Code Review or Step 7 Git Publication.

## Consolidated review-remediation Build — 2026-10-15 — database-free

This Build verified the R01–R13 findings against current source, applied scoped fixes and regression tests, and corrected the PF-05/PF-21 assertions. It also corrected the already-identified PF-16 post-reload message and PF-22 member-profile identity assertions. No acceptance scenario or live database operation was run; the final authorized run and PF ledger above remain unchanged historical evidence.

- Create response loss or malformed successful projections are classified as `WRITE_OUTCOME_UNKNOWN`; the composer retains and blocks the draft until the Feed refresh completes and the user explicitly confirms a retry. The refresh failure path does not unlock retry.
- Feed ordering now compares Neo4j temporal values before per-author/global limits. PF-05 checks API and persisted creation/update timestamps. PF-21 asserts non-vacuous 44px button measurements and a 4.5:1 text-contrast floor for rendered content/controls at its specified viewports; these scenario assertions were compiled/discovered only, not executed.
- Focus/session revalidation and ordinary Feed refresh preserve loaded cards/drafts; friendship-scope changes and confirmed 401s clear protected Posts. Post-detail mutation callbacks are route-scoped, and editor controls are disabled during a save.
- Neo4j `ServiceUnavailable`/`SessionExpired` errors map to sanitized HTTP 503 responses. Create/update OpenAPI schemas no longer impose a raw-length cap that conflicts with the normalized code-point limit.
- The guarded runner starts runtime sampling immediately, waits for an in-flight check at group stop, rejects empty/inconsistent Playwright reports, and captures bounded/sanitized service/browser-probe diagnostics. Unit coverage validates these mechanics; no guarded rerun was performed.
- Verification: `npm test` (**25 API suites / 178 tests; 20 Web files / 91 tests**); `npm run test:api:e2e` (**2 suites / 13 tests**); Posts helper/safety/monitor/contract tests (**47/47**); `npm run typecheck`; `npm run build`; strict standalone Playwright TypeScript; discovery-only listing (**5 tests / 1 file**); and JavaScript syntax checks passed. No standalone API/Vite service, Neo4j endpoint, or Playwright business scenario was started. Root HTTP integration was not run because it launches API/Vite services.
- **Step 5 remains BLOCKED.** The earlier group still has `checks=0`, and groups 2–4 remain unrun. The monitoring correction is not acceptance evidence and does not renew the consumed authorization.
