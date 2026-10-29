from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from isn_etl.publication import (
    PublicationError,
    create_staging_directory,
    publish_staged_run,
    read_completed_run,
    write_run_manifest,
)


RUN_ID = "a" * 64


class SafePublicationTests(unittest.TestCase):
    def test_completion_manifest_is_written_last_and_verified(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            staging, final = create_staging_directory(Path(directory), "fixture", RUN_ID)
            (staging / "gold").mkdir()
            (staging / "gold" / "part-000.parquet").write_bytes(b"test-parquet-placeholder")
            manifest = {"run_id": RUN_ID, "identity_sha256": "b" * 64, "status": "validated"}
            write_run_manifest(staging, manifest)

            self.assertFalse(final.exists())
            self.assertFalse((staging / "_COMPLETE.json").exists())
            published = publish_staged_run(staging, final, RUN_ID)

            self.assertTrue((published / "_COMPLETE.json").is_file())
            self.assertFalse(staging.exists())
            self.assertEqual(read_completed_run(published, RUN_ID), manifest)

    def test_rejects_incomplete_targets_and_preserves_existing_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            staging, final = create_staging_directory(Path(directory), "fixture", RUN_ID)
            final.mkdir(parents=True)
            existing = final / "partial.bin"
            existing.write_bytes(b"retain-me")
            write_run_manifest(staging, {"run_id": RUN_ID})

            with self.assertRaisesRegex(PublicationError, "incomplete|exists"):
                publish_staged_run(staging, final, RUN_ID)
            self.assertEqual(existing.read_bytes(), b"retain-me")
            with self.assertRaisesRegex(PublicationError, "completion|incomplete"):
                read_completed_run(final, RUN_ID)

    def test_rejects_manifest_tampering_and_wrong_run_identity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            staging, final = create_staging_directory(Path(directory), "fixture", RUN_ID)
            write_run_manifest(staging, {"run_id": RUN_ID, "identity_sha256": "b" * 64})
            published = publish_staged_run(staging, final, RUN_ID)
            (published / "_RUN_MANIFEST.json").write_text("{}", encoding="utf-8")

            with self.assertRaisesRegex(PublicationError, "manifest checksum"):
                read_completed_run(published, RUN_ID)
            with self.assertRaisesRegex(PublicationError, "run_id"):
                read_completed_run(published, "c" * 64)

    def test_refuses_to_replace_a_completed_run(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first_stage, final = create_staging_directory(root, "fixture", RUN_ID)
            write_run_manifest(first_stage, {"run_id": RUN_ID, "identity_sha256": "b" * 64})
            publish_staged_run(first_stage, final, RUN_ID)

            second_stage, same_final = create_staging_directory(root, "fixture", RUN_ID)
            write_run_manifest(second_stage, {"run_id": RUN_ID, "identity_sha256": "b" * 64})
            with self.assertRaisesRegex(PublicationError, "exists"):
                publish_staged_run(second_stage, same_final, RUN_ID)
            self.assertEqual(read_completed_run(final, RUN_ID)["identity_sha256"], "b" * 64)

    def test_interruption_after_final_reservation_remains_incomplete_and_preserved(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            staging, final = create_staging_directory(Path(directory), "fixture", RUN_ID)
            write_run_manifest(staging, {"run_id": RUN_ID, "identity_sha256": "b" * 64})
            original_rename = Path.rename

            def fail_manifest_move(source: Path, destination: Path) -> Path:
                if source == staging / "_RUN_MANIFEST.json":
                    raise OSError("injected failure after final-directory reservation")
                return original_rename(source, destination)

            with patch.object(Path, "rename", fail_manifest_move):
                with self.assertRaisesRegex(OSError, "injected failure"):
                    publish_staged_run(staging, final, RUN_ID)

            self.assertTrue(final.is_dir())
            self.assertTrue(staging.is_dir())
            self.assertTrue((staging / "_RUN_MANIFEST.json").is_file())
            self.assertFalse((final / "_COMPLETE.json").exists())
            self.assertEqual(list(final.iterdir()), [])
            with self.assertRaisesRegex(PublicationError, "incomplete"):
                read_completed_run(final, RUN_ID)

    def test_rejects_malformed_completion_marker_without_removing_publication(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            staging, final = create_staging_directory(Path(directory), "fixture", RUN_ID)
            write_run_manifest(staging, {"run_id": RUN_ID, "identity_sha256": "b" * 64})
            published = publish_staged_run(staging, final, RUN_ID)
            marker = published / "_COMPLETE.json"
            marker.write_text("{not json", encoding="utf-8")

            with self.assertRaisesRegex(PublicationError, "Cannot validate completed-run metadata"):
                read_completed_run(published, RUN_ID)
            self.assertTrue((published / "_RUN_MANIFEST.json").is_file())
            self.assertEqual(marker.read_text(encoding="utf-8"), "{not json")


if __name__ == "__main__":
    unittest.main()
