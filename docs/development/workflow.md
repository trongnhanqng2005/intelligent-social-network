# Development workflow and documentation Definition of Done

## Task flow

1. Use an approved feature/task scope and preserve documented constraints; inspect current code before proposing changes.
2. Implement in narrow slices and put each test at its established owner: app-local test for single-app behavior, `tests/integration/` for root non-browser component boundaries, and `tests/e2e/` for Playwright browser journeys.
3. For UI features, identify the user-facing browser scenario or document why an existing scenario covers it. Verify navigation, responsive behavior, keyboard/accessibility, and API/UI states where the change affects them. Use risk-based scope: a minor CSS-only adjustment does not automatically require the full desktop/mobile E2E matrix.
4. Run relevant focused tests, broader affected suites, typechecks/builds, and live system checks where required by the change. Record exact commands and outcomes in the task handoff.
5. Review changed docs against actual code and user-visible behavior before marking work complete.

## Mandatory documentation maintenance policy

For **every future development task**:

1. Identify which documentation is affected by the proposed behavior, contract, architecture, tests, setup, or milestone.
2. Update relevant business, architecture, API/integration, testing, or development documents alongside implementation. UI behavior changes must include an appropriate app-local or Playwright QA scenario update; test intensity should be proportionate to change risk.
3. Update root `README.md`, `docs/README.md`, and/or `docs/roadmap.md` when project entry points, milestones, scope, status, or major capabilities change.
4. Verify the changed documentation matches actual source/configuration and that its links and commands are valid before declaring the task complete.
5. If no documentation update is warranted, record that conclusion briefly in the task handoff and why.

This is part of the project Definition of Done, not optional cleanup. Keep future capabilities labeled planned until source and verification evidence support implemented status. Do not recreate `AGENTS.md`; it is reserved for the final project-completion stage.

## Completion handoff

Record scope, files changed, test paths and commands, verification outcomes, docs changed (or why none), unresolved decisions/risks, and the next authorized action. Keep review, Git bootstrap, commit, push and merge subject to their separate approvals.
