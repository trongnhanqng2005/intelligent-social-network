from __future__ import annotations

import contextlib
import io
import unittest
from pathlib import Path

from isn_etl.cli import main


FIXTURE_ROOT = Path(__file__).parents[2] / "fixtures" / "data_pipeline"


class CommandLineTests(unittest.TestCase):
    def test_prepare_source_reports_only_manifest_verified_provenance(self) -> None:
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            status = main(
                [
                    "prepare-source",
                    "--source",
                    str(FIXTURE_ROOT / "synthetic-edges.txt"),
                    "--manifest",
                    str(FIXTURE_ROOT / "synthetic-edges.manifest.json"),
                ]
            )

        self.assertEqual(status, 0)
        self.assertIn('"status": "verified"', stdout.getvalue())
        self.assertIn('"records": 10', stdout.getvalue())

    def test_prepare_source_keeps_unresolved_snap_candidate_blocked(self) -> None:
        config = Path(__file__).parents[3] / "data-pipeline" / "config" / "snap-facebook-combined.json"
        stdout = io.StringIO()
        stderr = io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            status = main(
                [
                    "prepare-source",
                    "--source",
                    "facebook_combined.txt.gz",
                    "--manifest",
                    str(config),
                ]
            )

        self.assertEqual(status, 2)
        self.assertIn("rights", stderr.getvalue().lower())
        self.assertEqual(stdout.getvalue(), "")


if __name__ == "__main__":
    unittest.main()
