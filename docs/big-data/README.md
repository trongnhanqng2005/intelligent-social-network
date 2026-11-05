# Planned Big Data and machine learning

The architecture and model documents describe proposal targets. The research activity contract is tracked separately. Source is the project proposal DOCX, sections 1 and 3–5. It gives conceptual responsibilities and initial model ideas, but does not settle deployment, operations, privacy, or production API contracts.

- [Activity Logging v1 research contract](activity-logging.md)
- [Target architecture and information flow](architecture.md)
- [Proposed data and model lifecycle](data-and-models.md)

The proposal's preferred starting direction is NestJS modular monolith + React + Neo4j, batch PySpark processing and Parquet Bronze/Silver/Gold. Kafka is explicitly optional for later near-real-time ingestion. Do not create pipeline, ML or dataset directories until that work is approved and implemented.
