# Development workflow and documentation Definition of Done

## Task flow

Use this as the default for substantial development, not a mandatory eight-stage
process for every change. The delivery unit is one independently testable,
reviewable and mergeable task on its own branch. Milestones organize backlog and
shared architecture/dependencies; their full scope is not a single task Plan or
long-lived feature branch. Related small fixes may stay in the active task, and
clear typo/config fixes need no repository plan files or separate branch by default.

1. Inspect the existing state and select the task scope. For a new substantial task, verify the `main` baseline and use a dedicated branch only with Git authorization; do not switch, update or discard a working tree with unrelated edits to satisfy the convention. No automatic fetch, pull, branch rename or publishing.
2. Use Plan for substantial or ambiguous work. Define only the selected task's scope, dependencies, acceptance criteria and verification; obtain Owner approval and an explicit Build implementation request. Persist `task/<slug>/plan.md` and `todo.md` for substantial/multi-session work when needed, in that same authorized Build turn.
3. Build the approved task scope in agent-selected increments, including in-scope fixes and docs. Increments are verification checkpoints, not mandatory approval stops. A task may span sessions; preserve scope, progress, blockers and evidence in its handoff. Ask for material scope/architecture changes or unapproved risky actions; pause for missing credentials, environment or business decisions rather than expanding scope or claiming completion.
4. Choose QA by risk and acceptance criteria: focused tests, affected suites, typechecks/builds and live checks where relevant. Keep app-local tests with their app, root component-boundary tests in `tests/integration/`, and browser journeys in `tests/e2e/`. Documentation-only changes may use consistency/link checks without application builds; record why checks are applicable or not.
5. For UI work, use the existing UI/UX skills and Playwright MCP to inspect relevant interactions, states, accessibility and desktop/mobile behavior. Save critical journeys in Playwright Test; interactive evidence does not replace regression tests. Fix observed failures and recheck against acceptance criteria, not unbounded aesthetic preferences. Minor changes do not require every suite or viewport; report unavailable checks as pending.
6. Self-review is part of Build. Formal read-only Plan review applies when requested or before merge, with fixes and reverification as needed. Completion requires the applicable checks and docs to agree, not just code written or tests run once. Commit, push, PR and merge remain explicitly authorized actions; after merge, the next substantial task starts from a verified updated `main` baseline.

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
