# Project overview

## Purpose

The project is a university Intelligent Social Network / Big Data system. Its approved proposal targets a small social network plus graph-based friend recommendation and activity anomaly detection, backed by a reproducible data-processing and model-evaluation workflow. See [proposal-derived requirements](business/requirements.md) and [planned data/ML design](big-data/README.md).

## Scope and status

| Area | Status |
|---|---|
| npm workspace with NestJS API and React web client | Implemented and verified |
| `GET /health` returning HTTP 200 and `{"status":"ok"}` | Implemented and verified |
| Neo4j driver, authenticated Server 2026.09.0 Enterprise access, isolated `isn-test` identity, cumulative V1–V3 migrations and `GET /ready` | Implemented and verified against both local databases; V3 profile index is ONLINE and test access remains isolated |
| Vite `/api` development proxy forwarding the API health contract | Implemented and verified independently of the public homepage |
| Email/password registration, RS256-backed 24-hour Neo4j sessions, CSRF/origin defense, restoration and logout/revocation | Implemented and verified; event retention policy remains pending |
| Authenticated profiles, optimistic profile editing, member search/directory and member-visible profiles | Implemented; real `isn-test` persistence, privacy, search and concurrent-update behavior verified |
| Weylume public homepage, authentication/profile/discovery presentation and not-found screen | Implemented; remaining social capabilities remain planned |
| Posts, interactions, friendships, recommendations, admin, account recovery | Planned; not implemented |
| Social graph/domain, event collection, PySpark, Parquet layers, ML, recommendation/alert integration | Planned direction; not implemented |
| Production deployment, production routing, operational security policy | Not configured |

The current authentication, profile and foundation verification commands and results are recorded in [testing](development/testing.md). Real Neo4j tests use synthetic owned fixtures and prove test-database isolation; browser MCP implementation smoke remains distinct from saved Scenario Testing.

## Technology

Current: Node.js 24 / npm 11 workspaces; NestJS 12, TypeScript 6, Jest 30 and Supertest; React 19, React Router 7, Vite 8, Vitest 5 and React Testing Library. Planned: Neo4j/Cypher and optional GDS, PySpark, Parquet and Python/scikit-learn. The proposal mentions Kafka only as a possible later streaming extension.

## Principles

- Keep the current app small; introduce modules, infrastructure adapters and shared frontend layers when real responsibilities arise.
- Describe source-backed behavior separately from target architecture and unresolved design choices.
- Keep Node/Nest application transactions distinct from batch ETL and model training responsibilities, subject to later approved integration design.
- Treat recommendations and anomaly scores as uncertain decision support, not proof or automatic enforcement.

See [current architecture](architecture/README.md), [roadmap](roadmap.md), and the proposal reference at `D:/DoAn/BigData/docs/De_cuong_du_kien_trien_khai_Mang_xa_hoi_Big_Data.docx` (reference only; not maintained here).
