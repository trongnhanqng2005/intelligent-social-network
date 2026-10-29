# Project documentation

This is the navigation index for the Intelligent Social Network. Code is authoritative for implemented behavior; the proposal is a planning reference for future business and Big Data requirements. See [status and scope](overview.md) before treating any capability as implemented.

## Sections

- [Overview](overview.md) — purpose, stack and implementation status.
- [Business](business/README.md) — proposal-derived actors, use cases and rules; all are planned unless explicitly marked implemented.
- [API contracts](api/README.md) — implemented health, authentication, User Profile & Discovery, Friendship, and Posts & Feed source interfaces, including [Posts & Feed](api/posts-feed.md) and [OpenAPI](api/openapi.yaml). Owner-authorized V5 and focused Posts verification on restricted `isn-test` are recorded in the Neo4j operations guide; no `isn-dev` Posts status is inferred.
- [Architecture](architecture/README.md) — source-based current application, integration boundary and Mermaid views.
- [Big Data and ML](big-data/README.md) — proposed graph, event, Parquet, PySpark and model flows with open questions.
- [Development](development/README.md) — setup, Neo4j local operations, commands, testing and [documentation maintenance policy](development/workflow.md).
- [Roadmap](roadmap.md) — dependencies, milestones and current progress.

Update relevant documents with implementation changes. The documentation Definition of Done is in [workflow.md](development/workflow.md).
