from __future__ import annotations

import hashlib
import unittest

from pyspark.sql.types import LongType, StringType, StructField, StructType

from tests.integration.data_pipeline.acceptance_verify import (
    _check_manifest_schema,
    _check_worker_report,
    _check_schema,
    _logical_digest,
    _table_read_schema,
)


class IndependentVerifierLogicalDigestTests(unittest.TestCase):
    def test_empty_rows_match_producer_empty_digest(self) -> None:
        self.assertEqual(_logical_digest([]), hashlib.sha256(b"").hexdigest())

    def test_rows_are_sorted_utf8_and_each_terminated_by_lf(self) -> None:
        rows = ['{"id":2,"text":"é"}', '{"id":1,"text":null}', '{"id":2,"text":"é"}']
        producer_digest = hashlib.sha256()
        for row in sorted(rows):
            producer_digest.update(row.encode("utf-8"))
            producer_digest.update(b"\n")
        self.assertEqual(_logical_digest(rows), producer_digest.hexdigest())

    def test_worker_requires_clean_teardown_and_resource_counters(self) -> None:
        report = {
            "resources": {
                "spark_context_stopped": True,
                "active_spark_session_after_stop": False,
                "before_spark": {
                    "cgroup_pids_events": {"max": 0},
                    "cgroup_memory_events": {"oom": 0, "oom_kill": 0},
                },
                "after_spark_stop": {
                    "cgroup_pids_events": {"max": 0},
                    "cgroup_memory_events": {"oom": 0, "oom_kill": 0},
                },
            }
        }
        _check_worker_report(report, "case")
        report["resources"]["after_spark_stop"]["cgroup_pids_events"]["max"] = 1
        with self.assertRaisesRegex(AssertionError, "resource/teardown"):
            _check_worker_report(report, "case")

    def test_worker_rejects_memory_oom_and_unclean_spark_context(self) -> None:
        report = {
            "resources": {
                "spark_context_stopped": True,
                "active_spark_session_after_stop": False,
                "before_spark": {
                    "cgroup_pids_events": {"max": 0},
                    "cgroup_memory_events": {"oom": 0, "oom_kill": 0},
                },
                "after_spark_stop": {
                    "cgroup_pids_events": {"max": 0},
                    "cgroup_memory_events": {"oom": 1, "oom_kill": 0},
                },
            }
        }
        with self.assertRaisesRegex(AssertionError, "resource/teardown"):
            _check_worker_report(report, "case")


class IndependentVerifierSchemaTests(unittest.TestCase):
    expected = {
        "expected_parquet_schemas": {
            "silver/nodes": [
                "dataset_id:string",
                "source_version:string",
                "source_node_id:bigint",
            ]
        }
    }

    def test_footer_nullability_normalization_does_not_change_logical_contract(self) -> None:
        footer_schema = StructType(
            [
                StructField("dataset_id", StringType(), nullable=True),
                StructField("source_version", StringType(), nullable=True),
                StructField("source_node_id", LongType(), nullable=True),
            ]
        )

        _check_schema(
            footer_schema,
            self.expected,
            "silver/nodes",
            footer=True,
            verify_nullability=False,
        )

    def test_declared_schema_still_requires_contract_nullability(self) -> None:
        declared_schema = StructType(
            [
                StructField("dataset_id", StringType(), nullable=True),
                StructField("source_version", StringType(), nullable=False),
                StructField("source_node_id", LongType(), nullable=False),
            ]
        )

        with self.assertRaisesRegex(AssertionError, "nullability"):
            _check_schema(
                declared_schema,
                self.expected,
                "silver/nodes",
                footer=True,
            )

    def test_spark_read_schema_remains_nullable(self) -> None:
        read_schema = StructType(
            [
                StructField("dataset_id", StringType(), nullable=True),
                StructField("source_version", StringType(), nullable=True),
                StructField("source_node_id", LongType(), nullable=True),
            ]
        )

        _check_schema(read_schema, self.expected, "silver/nodes", footer=False)

        read_schema.fields[0].nullable = False
        with self.assertRaisesRegex(AssertionError, "read schema nullability"):
            _check_schema(read_schema, self.expected, "silver/nodes", footer=False)

    def test_manifest_schema_hash_uses_declared_schema_not_normalized_footer(self) -> None:
        declared_schema = StructType(
            [
                StructField("dataset_id", StringType(), nullable=False),
                StructField("source_version", StringType(), nullable=False),
                StructField("source_node_id", LongType(), nullable=False),
            ]
        )
        footer_schema = StructType(
            [
                StructField("dataset_id", StringType(), nullable=True),
                StructField("source_version", StringType(), nullable=True),
                StructField("source_node_id", LongType(), nullable=True),
            ]
        )
        manifest_output = {
            "schema": declared_schema.jsonValue(),
            "schema_sha256": hashlib.sha256(declared_schema.json().encode("utf-8")).hexdigest(),
        }

        footer_hash = hashlib.sha256(footer_schema.json().encode("utf-8")).hexdigest()
        self.assertNotEqual(manifest_output["schema_sha256"], footer_hash)
        self.assertEqual(
            _check_manifest_schema(manifest_output, self.expected, "silver/nodes"),
            declared_schema,
        )

        manifest_output["schema_sha256"] = footer_hash
        with self.assertRaisesRegex(AssertionError, "manifest schema hash"):
            _check_manifest_schema(manifest_output, self.expected, "silver/nodes")

    def test_table_read_schema_is_explicit_ordered_and_nullable(self) -> None:
        schema = _table_read_schema(self.expected, "silver/nodes")

        self.assertEqual(
            [(field.name, field.dataType.simpleString(), field.nullable) for field in schema.fields],
            [
                ("dataset_id", "string", True),
                ("source_version", "string", True),
                ("source_node_id", "bigint", True),
            ],
        )


if __name__ == "__main__":
    unittest.main()
