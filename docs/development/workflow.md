# Development workflow and documentation Definition of Done

## Task flow

For Owner-approved development tasks, follow this seven-step sequence. The
delivery unit is one independently testable, reviewable and mergeable task on
its own branch. Milestones organize backlog and shared architecture/dependencies;
their full scope is not one task Plan or long-lived feature branch. Related small
fixes may stay in the active task; avoid unnecessary task fragmentation or
repeated reviews.

1. **Branch (Build):** Create a clean feature branch from verified `main`, one
   task per branch. Branch creation and other Git mutations require Owner
   authorization; preserve unrelated work and never reset, clean, stash, or
   discard it to satisfy the convention.
2. **Plan:** OpenCode prepares a focused task plan. The technical adviser reviews
   it, then the Project Owner explicitly approves it. Plan only the selected task,
   its dependencies, acceptance criteria, risks, and verification.
3. **Save Plan (Build):** Save the approved plan and checklist in
   `task/<slug>/plan.md` and `task/<slug>/todo.md`. Preserve other task records
   and update progress with actual evidence.
4. **Implementation (Build):** Implement the complete approved task using TDD;
   update code, todo, and affected documentation. UI work requires the existing
   UI UX Pro Max skill and iterative Playwright MCP inspection. TDD and Build
   smoke checks do not replace Scenario Testing.
5. **Scenario Testing (Plan → Build):** Prepare a separate acceptance-test plan,
   especially real E2E scenarios. Obtain technical review and explicit Owner
   approval before implementing or executing that scenario plan. Fix failures
   during Build and reverify; do not infer authorization from a passing report.
6. **Independent Code Review:** Review architecture, implementation, security,
   and tests independently of Build. Fix confirmed issues and reverify affected
   behavior. A review result does not authorize the next phase.
7. **Git Publication:** Only with explicit Owner authorization, commit, push,
   create a PR, and merge within the approved scope.

The Project Owner has final approval authority. No phase transition is inferred
from a passing agent report. The technical adviser must not write an OpenCode
prompt without the Owner's explicit request or approval. Build increments are
internal verification checkpoints, not additional approval stops. Keep applicable
tests with their app; root component-boundary tests in `tests/integration/`, and
browser journeys in `tests/e2e/`. Choose QA proportional to risk and report
unavailable prerequisites instead of claiming success. Documentation-only work
may use consistency/link checks without application builds; record why.

## Mandatory documentation maintenance policy

For **every future development task**:

1. Identify which documentation is affected by the proposed behavior, contract, architecture, tests, setup, or milestone.
2. Update relevant business, architecture, API/integration, testing, or development documents alongside implementation. UI behavior changes must include an appropriate app-local or Playwright QA scenario update; test intensity should be proportionate to change risk.
3. Update root `README.md`, `docs/README.md`, and/or `docs/roadmap.md` when project entry points, milestones, scope, status, or major capabilities change.
4. Verify the changed documentation matches actual source/configuration and that its links and commands are valid before declaring the task complete.
5. If no documentation update is warranted, record that conclusion briefly in the task handoff and why.

This is part of the project Definition of Done, not optional cleanup. Keep future capabilities labeled planned until source and verification evidence support implemented status. Maintain the existing root `AGENTS.md` as the project changes; do not recreate or overwrite it wholesale without an explicit Owner request, and do not add nested `AGENTS.md` files.

## Completion handoff

Record scope, files changed, test paths and commands, verification outcomes, docs changed (or why none), unresolved decisions/risks, and the next authorized action. Keep review, Git bootstrap, commit, push and merge subject to their separate approvals.
