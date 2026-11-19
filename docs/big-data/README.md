# Big Data and machine learning

The project proposal describes target architecture and models. The implemented work includes Activity Logging v1 for research and a standalone PySpark edge-list pipeline. Application-wide feature engineering, model serving, and production integration remain planned.

- [Activity Logging v1 research contract](activity-logging.md)

- [Implemented standalone graph ingestion and run contract](ingestion-etl.md)
- [Dataset provenance and rights gate](dataset-provenance.md)
- [Bronze/Silver/Gold Parquet contracts](parquet-contracts.md)
- [Target architecture and information flow](architecture.md)
- [Proposed data and model lifecycle](data-and-models.md)

The proposal's preferred direction is NestJS modular monolith + React + Neo4j, batch PySpark processing and Parquet Bronze/Silver/Gold. The current ETL is an independent file-based edge-list tool, not an application integration. Kafka is optional for a later near-real-time path. ML, event ingestion, real-source acceptance, and production integration require separate approvals and contracts.
