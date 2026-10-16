# Roadmap

This roadmap distinguishes completed foundation work from proposal requirements. The proposal does not authorize a specific delivery sequence or resolve implementation details; milestones below are a dependency-aware project outline, not proof of implementation.

| Milestone | Scope | Status / dependency |
|---|---|---|
| 1. Application foundation | npm workspaces, NestJS health API, React shell, dev proxy, app-local tests | Complete; final architecture review PASS. |
| 2. Documentation and testing foundation | Project docs, root test policy and executable cross-component test | Complete: docs/indexes, root HTTP integration test, and Playwright desktop/mobile QA (12 browser tests) verified. |
| 3. Social-network domain foundation | Agree API/data contracts, authentication/security, user/profile, post/interactions and friendship rules; implement in thin slices | Authentication, User Profile & Discovery, Friendship, and Posts & Feed are implemented. V5 and focused real Posts behavior are verified on restricted `isn-test`; Step 5 Scenario Testing remains separate. Likes/comments and account recovery remain unimplemented. |
| 4. Events and graph data | Define event/privacy contract and Neo4j schema/transaction semantics; ingest selected source data | Not started; depends on domain identifiers, event model, dataset rights and Neo4j deployment choice. |
| 5. Batch data platform | Reproducible ingestion/cleaning/features; Parquet Bronze/Silver/Gold and quarantine | Not started; depends on source schemas, storage and data-quality policies. |
| 6. ML experiments | Link prediction and anomaly experiments, leakage-safe splits, baselines, evaluation and reproducibility | Not started; depends on usable graph/events and agreed metrics. No model result exists. |
| 7. Prediction integration and admin review | Publish recommendation scores and anomaly alerts for API/UI; human review remains in control | Not started; depends on stable model output contract, refresh cadence, and authorization/privacy design. |
| 8. Production readiness | Production routing, security headers/TLS, secrets, deployment, monitoring, recovery and CI decisions | Not started; separate from the loopback foundation. |

## Immediate prerequisite and questions

The centralized root `tests/` conventions and runnable system-level tests are established. For each next feature plan, name the app-local tests and any new cross-component scenarios under `tests/`.

Resolve incrementally before the affected work: production deployment and shared abuse-control strategy; event retention/PII controls (pending before real-user production use); dataset license and mapping of anonymous SNAP identities; batch versus near-real-time refresh needs; model-serving/storage and versioning; alert review/retention; evaluation protocol and acceptable quality thresholds. Authentication uses a fixed 24-hour server-backed browser session; account recovery and social domains beyond basic profile discovery remain unimplemented. Kafka is optional in the proposal, not a prerequisite.

Do not create `data-pipeline/`, `machine-learning/`, or `datasets/` before the associated work is approved and implemented. Keep progress current as capabilities land.
