from __future__ import annotations

import gzip
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from isn_etl.provenance import (
    SourceValidationError,
    load_manifest,
    stable_record_id,
    stable_run_id,
    validate_source,
)


FIXTURE_DIR = Path(__file__).parents[2] / "fixtures" / "data_pipeline"
FIXTURE_SOURCE = FIXTURE_DIR / "synthetic-edges.txt"
FIXTURE_MANIFEST = FIXTURE_DIR / "synthetic-edges.manifest.json"


def sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def manifest_for(source_name: str, source_content: bytes, content: bytes, **overrides: object) -> dict[str, object]:
    data: dict[str, object] = {
        "manifest_version": 1,
        "dataset_id": "unit-fixture",
        "source_file": source_name,
        "source_format": "plain",
        "graph_semantics": "undirected_edge_list",
        "source_sha256": sha256(source_content),
        "uncompressed_sha256": sha256(content),
        "source_bytes": len(source_content),
        "content_bytes": len(content),
        "acquired_at": None,
        "source_url": None,
        "citation": "Original unit-test bytes.",
        "rights_status": "synthetic",
        "rights_evidence": "Authored test input.",
        "schema_version": "1.0.0",
        "transform_version": "1.0.0",
        "quality_policy_version": "1.0.0",
    }
    data.update(overrides)
    return data


class ProvenanceTests(unittest.TestCase):
    def test_validates_original_synthetic_fixture_and_preserves_logical_lines(self) -> None:
        manifest = load_manifest(FIXTURE_MANIFEST)
        source = validate_source(FIXTURE_SOURCE, manifest)

        self.assertEqual(source.source_version, manifest.source_sha256)
        self.assertEqual(source.source_sha256, manifest.source_sha256)
        self.assertEqual(source.uncompressed_sha256, manifest.uncompressed_sha256)
        self.assertEqual(source.source_bytes, 101)
        self.assertEqual(source.content_bytes, 101)
        self.assertEqual(manifest.graph_semantics, "undirected_edge_list")
        self.assertEqual(len(source.records), 10)
        self.assertEqual(source.records[0], (1, "# Original synthetic edge-list fixture for ISN-B"))
        self.assertEqual(source.records[3], (4, ""))

    def test_stable_record_ids_and_run_ids_are_content_derived(self) -> None:
        manifest = load_manifest(FIXTURE_MANIFEST)
        source = validate_source(FIXTURE_SOURCE, manifest)

        first = stable_record_id(source.source_version, manifest.source_file, 2)
        self.assertEqual(first, stable_record_id(source.source_version, manifest.source_file, 2))
        self.assertNotEqual(first, stable_record_id(source.source_version, manifest.source_file, 3))
        run_id = stable_run_id(manifest, source.source_version)
        self.assertEqual(run_id, stable_run_id(manifest, source.source_version))
        self.assertEqual(len(run_id), 64)
        self.assertNotEqual(
            run_id,
            stable_run_id(manifest, source.source_version, extra_config={"shuffle_partitions": 3}),
        )

    def test_validates_gzip_checksum_and_decompressed_checksum(self) -> None:
        content = b"8 9\n9 10\n"
        compressed = gzip.compress(content, mtime=0)
        data = manifest_for(
            "edges.txt.gz",
            compressed,
            content,
            source_format="gzip",
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_path = root / "edges.txt.gz"
            manifest_path = root / "manifest.json"
            source_path.write_bytes(compressed)
            manifest_path.write_text(json.dumps(data), encoding="utf-8")

            verified = validate_source(source_path, load_manifest(manifest_path))

        self.assertEqual(verified.records, ((1, "8 9"), (2, "9 10")))
        self.assertEqual(verified.content_bytes, len(content))

    def test_rejects_missing_source_and_checksum_mismatch(self) -> None:
        data = manifest_for("edges.txt", b"1 2\n", b"1 2\n")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path = root / "manifest.json"
            manifest_path.write_text(json.dumps(data), encoding="utf-8")
            manifest = load_manifest(manifest_path)
            with self.assertRaisesRegex(SourceValidationError, "not found"):
                validate_source(root / "missing.txt", manifest)

            source_path = root / "edges.txt"
            source_path.write_text("1 3\n", encoding="utf-8")
            with self.assertRaisesRegex(SourceValidationError, "SHA-256 mismatch"):
                validate_source(source_path, manifest)

    def test_rejects_source_and_decompressed_byte_size_mismatches(self) -> None:
        content = b"1 2\n"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_path = root / "edges.txt"
            source_path.write_bytes(content)
            manifest_path = root / "manifest.json"

            data = manifest_for(source_path.name, content, content, source_bytes=len(content) + 1)
            manifest_path.write_text(json.dumps(data), encoding="utf-8")
            with self.assertRaisesRegex(SourceValidationError, "byte-size mismatch"):
                validate_source(source_path, load_manifest(manifest_path))

            data = manifest_for(source_path.name, content, content, content_bytes=len(content) + 1)
            manifest_path.write_text(json.dumps(data), encoding="utf-8")
            with self.assertRaisesRegex(SourceValidationError, "byte-size mismatch"):
                validate_source(source_path, load_manifest(manifest_path))

    def test_rejects_bad_decompressed_hash_corrupt_gzip_and_invalid_utf8(self) -> None:
        content = b"1 2\n"
        compressed = gzip.compress(content, mtime=0)
        data = manifest_for(
            "edges.txt.gz",
            compressed,
            b"2 3\n",
            source_format="gzip",
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_path = root / "edges.txt.gz"
            manifest_path = root / "manifest.json"
            source_path.write_bytes(compressed)
            manifest_path.write_text(json.dumps(data), encoding="utf-8")
            with self.assertRaisesRegex(SourceValidationError, "(?i)decompressed SHA-256 mismatch"):
                validate_source(source_path, load_manifest(manifest_path))

            corrupt_path = root / "corrupt.txt.gz"
            corrupt_path.write_bytes(b"not a gzip stream")
            corrupt_manifest_data = manifest_for(
                corrupt_path.name,
                corrupt_path.read_bytes(),
                b"",
                source_format="gzip",
            )
            corrupt_manifest_path = root / "corrupt.manifest.json"
            corrupt_manifest_path.write_text(json.dumps(corrupt_manifest_data), encoding="utf-8")
            with self.assertRaisesRegex(SourceValidationError, "gzip"):
                validate_source(corrupt_path, load_manifest(corrupt_manifest_path))

            invalid_path = root / "invalid.txt"
            invalid_bytes = b"1 \xff\n"
            invalid_path.write_bytes(invalid_bytes)
            invalid_manifest_path = root / "invalid.manifest.json"
            invalid_manifest_path.write_text(
                json.dumps(manifest_for(invalid_path.name, invalid_bytes, invalid_bytes)),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(SourceValidationError, "UTF-8"):
                validate_source(invalid_path, load_manifest(invalid_manifest_path))

    def test_rejects_empty_or_unapproved_source_and_unsafe_manifest_names(self) -> None:
        empty = b""
        unresolved = manifest_for(
            "snap.txt.gz",
            empty,
            empty,
            rights_status="unresolved",
            rights_evidence=None,
        )
        unsafe = manifest_for("../edges.txt", b"1 2\n", b"1 2\n")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path = root / "manifest.json"
            source_path = root / "snap.txt.gz"
            source_path.write_bytes(empty)
            manifest_path.write_text(json.dumps(unresolved), encoding="utf-8")
            with self.assertRaisesRegex(SourceValidationError, "rights|unresolved"):
                validate_source(source_path, load_manifest(manifest_path))

            manifest_path.write_text(json.dumps(unsafe), encoding="utf-8")
            with self.assertRaisesRegex(SourceValidationError, "source_file"):
                load_manifest(manifest_path)

            empty_manifest = manifest_for(source_path.name, empty, empty)
            manifest_path.write_text(json.dumps(empty_manifest), encoding="utf-8")
            with self.assertRaisesRegex(SourceValidationError, "empty"):
                validate_source(source_path, load_manifest(manifest_path))

    def test_approved_source_requires_a_timezone_aware_acquisition_time(self) -> None:
        source_bytes = b"1 2\n"
        data = manifest_for(
            "edges.txt",
            source_bytes,
            source_bytes,
            rights_status="approved",
            rights_evidence="Owner-provided rights evidence.",
            source_url="https://example.invalid/edges.txt",
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_path = root / "edges.txt"
            source_path.write_bytes(source_bytes)
            manifest_path = root / "manifest.json"

            data["acquired_at"] = "2026-10-14T12:00:00"
            manifest_path.write_text(json.dumps(data), encoding="utf-8")
            with self.assertRaisesRegex(SourceValidationError, "timezone"):
                load_manifest(manifest_path)

            data["acquired_at"] = None
            manifest_path.write_text(json.dumps(data), encoding="utf-8")
            with self.assertRaisesRegex(SourceValidationError, "acquired_at"):
                validate_source(source_path, load_manifest(manifest_path))


if __name__ == "__main__":
    unittest.main()
