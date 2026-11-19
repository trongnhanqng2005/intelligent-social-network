# Roadmap

This roadmap distinguishes completed foundation work from proposal requirements. The proposal does not authorize a specific delivery sequence or resolve implementation details; milestones below are a dependency-aware project outline, not proof of implementation.

| Milestone | Scope | Status / dependency |
|---|---|---|
| 1. Application foundation | npm workspaces, NestJS health API, React shell, dev proxy, app-local tests | Complete; final architecture review PASS. |
| 2. Documentation and testing foundation | Project docs, root test policy and executable cross-component test | Complete: docs/indexes, root HTTP integration test, and Playwright desktop/mobile QA (12 browser tests) verified. |
| 3. Social-network domain foundation | Agree API/data contracts, authentication/security, user/profile, post/interactions and friendship rules; implement in thin slices | Authentication, User Profile & Discovery, Friendship, and Posts & Feed are implemented. V5/focused Posts behavior was verified on restricted `isn-test`; Likes & Comments are integrated on main. V6 and real rollback-isolated repository tests passed on restricted `isn-test`. Focused React, NestJS and Neo4j V6 acceptance passed on restricted `isn-test`. Account recovery remains unimplemented. Production readiness remains separate. |
| 4. Events and graph data | Define event/privacy contract and Neo4j schema/transaction semantics; ingest selected source data | Activity Logging v1 research implementation acceptance passed on restricted `isn-test` on 2026-11-05, including verified V7 and serial capture/concurrency/operator scenarios. PR #10 merged after independent review. Automating the research jobs remains out of scope. Public dataset rights and production policy remain separate. |
| 5. Batch data platform | Static edge-list ingestion, Parquet Bronze/Silver/Gold and quarantine, then feature processing | Standalone ETL implemented. Full acceptance and feature processing remain pending. |
| 6. ML experiments | Link prediction and anomaly experiments, leakage-safe splits, baselines, evaluation and reproducibility | Not started; depends on usable graph/events and agreed metrics. No model result exists. |
| 7. Prediction integration and admin review | Publish recommendation scores and anomaly alerts for API/UI; human review remains in control | Not started; depends on stable model output contract, refresh cadence, and authorization/privacy design. |
| 8. Production readiness | Production routing, security headers/TLS, secrets, deployment, monitoring, recovery and CI decisions | Not started; separate from the loopback foundation. |

Standalone Spark ETL is implemented. The integration gate is synthetic full-driver acceptance on the pinned runtime. SNAP real-source reproduction requires a separate data-use review. [Spark ETL acceptance](../tests/integration/data_pipeline/acceptance.md).

## Immediate prerequisite and questions

The centralized root `tests/` conventions and runnable system-level tests are established. For each next feature plan, name the app-local tests and any new cross-component scenarios under `tests/`.

Resolve incrementally before the affected work: production deployment and shared abuse-control strategy; event retention/PII controls (pending before real-user production use); dataset license and mapping of anonymous SNAP identities; batch versus near-real-time refresh needs; model-serving/storage and versioning; alert review/retention; evaluation protocol and acceptable quality thresholds. Authentication uses a fixed 24-hour server-backed browser session; account recovery and social domains beyond basic profile discovery remain unimplemented. Kafka is optional in the proposal, not a prerequisite.

The standalone `data-pipeline/` scope is approved and implemented. Do not infer approval for `machine-learning/`, real dataset acquisition, event processing, or application integration. Keep progress current as separately approved capabilities land.
