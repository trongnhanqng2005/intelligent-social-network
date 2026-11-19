from __future__ import annotations

import unittest

from isn_etl.gold import analytical_node_id
from isn_etl.schemas import (
    GOLD_EDGES_SCHEMA,
    GOLD_NODES_SCHEMA,
    QUARANTINE_SCHEMA,
    QUALITY_METRICS_SCHEMA,
    RAW_EDGE_SCHEMA,
    SILVER_EDGES_SCHEMA,
    SILVER_NODES_SCHEMA,
    SOURCE_METADATA_SCHEMA,
)


class ExplicitSchemaTests(unittest.TestCase):
    def test_bronze_silver_and_gold_field_names_and_types_are_stable(self) -> None:
        self.assertEqual(
            [(field.name, field.dataType.simpleString()) for field in RAW_EDGE_SCHEMA.fields],
            [
                ("dataset_id", "string"),
                ("source_version", "string"),
                ("source_file", "string"),
                ("line_number", "bigint"),
                ("record_id", "string"),
                ("raw_text", "string"),
                ("ingested_at", "timestamp"),
            ],
        )
        self.assertEqual(
            SOURCE_METADATA_SCHEMA.fieldNames()[0:5],
            ["dataset_id", "source_version", "source_file", "source_format", "graph_semantics"],
        )
        self.assertEqual(SILVER_NODES_SCHEMA.fieldNames(), ["dataset_id", "source_version", "source_node_id"])
        self.assertEqual(
            SILVER_EDGES_SCHEMA.fieldNames(),
            ["dataset_id", "source_version", "source_node_id_low", "source_node_id_high", "source_record_count"],
        )
        self.assertEqual(QUARANTINE_SCHEMA.fieldNames()[-1], "reason_code")
        self.assertEqual(QUALITY_METRICS_SCHEMA.fieldNames()[-1], "value")
        self.assertEqual(GOLD_NODES_SCHEMA.fieldNames(), ["dataset_id", "source_version", "node_id", "source_node_id"])
        self.assertEqual(GOLD_EDGES_SCHEMA.fieldNames(), ["dataset_id", "source_version", "node_id_low", "node_id_high"])

    def test_required_contract_fields_are_non_nullable(self) -> None:
        for schema in (
            RAW_EDGE_SCHEMA,
            SILVER_NODES_SCHEMA,
            SILVER_EDGES_SCHEMA,
            QUARANTINE_SCHEMA,
            QUALITY_METRICS_SCHEMA,
            GOLD_NODES_SCHEMA,
            GOLD_EDGES_SCHEMA,
        ):
            with self.subTest(schema=schema.fieldNames()):
                self.assertTrue(all(not field.nullable for field in schema.fields))
        self.assertTrue(SOURCE_METADATA_SCHEMA["source_url"].nullable)
        self.assertTrue(SOURCE_METADATA_SCHEMA["rights_evidence"].nullable)
        self.assertTrue(SOURCE_METADATA_SCHEMA["acquired_at"].nullable)

    def test_stable_analytical_node_identity_uses_dataset_namespace(self) -> None:
        self.assertEqual(analytical_node_id("snap-facebook-combined", 22), "snap-facebook-combined:22")
        self.assertEqual(analytical_node_id("isn-synthetic-edges-v1", 0), "isn-synthetic-edges-v1:0")
        with self.assertRaises(ValueError):
            analytical_node_id("snap-facebook-combined", -1)


if __name__ == "__main__":
    unittest.main()
