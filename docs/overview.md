# Project overview

## Purpose

The project is a university Intelligent Social Network / Big Data system. Its approved proposal targets a small social network plus graph-based friend recommendation and activity anomaly detection, backed by a reproducible data-processing and model-evaluation workflow. See [proposal-derived requirements](business/requirements.md) and [planned data/ML design](big-data/README.md).

## Scope and status

| Area | Status |
|---|---|
| npm workspace with NestJS API and React web client | Implemented and verified |
| `GET /health` returning HTTP 200 and `{"status":"ok"}` | Implemented and verified |
| Browser-to-API health request through Vite `/api` development proxy | Implemented and verified |
| Authentication, profiles, posts, interactions, friendships, admin | Approved proposal requirements; not implemented |
| Neo4j, event collection, PySpark, Parquet layers, ML, recommendation/alert integration | Planned direction; not implemented |
| Production deployment, production routing, operational security policy | Not configured |

The initial foundation verification recorded API 18 unit tests + 1 API E2E, Web 30 tests, successful typechecks/builds and live browser proxy verification. Root QA now includes a Node HTTP proxy integration check and Playwright desktop/mobile browser scenarios; see [testing](development/testing.md) for commands and results.

## Technology

Current: Node.js 24 / npm 11 workspaces; NestJS 12, TypeScript 6, Jest 30 and Supertest; React 19, React Router 7, Vite 8, Vitest 5 and React Testing Library. Planned: Neo4j/Cypher and optional GDS, PySpark, Parquet and Python/scikit-learn. The proposal mentions Kafka only as a possible later streaming extension.

## Principles

- Keep the current app small; introduce modules, infrastructure adapters and shared frontend layers when real responsibilities arise.
- Describe source-backed behavior separately from target architecture and unresolved design choices.
- Keep Node/Nest application transactions distinct from batch ETL and model training responsibilities, subject to later approved integration design.
- Treat recommendations and anomaly scores as uncertain decision support, not proof or automatic enforcement.

See [current architecture](architecture/README.md), [roadmap](roadmap.md), and the proposal reference at `D:/DoAn/BigData/docs/De_cuong_du_kien_trien_khai_Mang_xa_hoi_Big_Data.docx` (reference only; not maintained here).
