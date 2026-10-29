# Big Data and machine learning

The project proposal (DOCX, sections 1 and 3–5) describes conceptual responsibilities and initial model ideas; it does not settle deployment, operations, privacy, or production API contracts. A narrowly scoped, standalone synthetic graph-edge ETL is now implemented; the application-wide event, feature, ML, and serving lifecycle remains proposed and unimplemented.

- [Implemented standalone graph ingestion and run contract](ingestion-etl.md)
- [Dataset provenance and rights gate](dataset-provenance.md)
- [Bronze/Silver/Gold Parquet contracts](parquet-contracts.md)
- [Target architecture and information flow](architecture.md)
- [Proposed data and model lifecycle](data-and-models.md)

The proposal's preferred direction is NestJS modular monolith + React + Neo4j, batch PySpark processing and Parquet Bronze/Silver/Gold. The current ETL is an independent file-based edge-list tool, not an application integration. Kafka is optional for a later near-real-time path. ML, event ingestion, real-source acceptance, and production integration require separate approvals and contracts.
