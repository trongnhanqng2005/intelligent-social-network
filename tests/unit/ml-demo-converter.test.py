import importlib.util
import json
import unittest
import tempfile
from datetime import datetime, timezone
import pyarrow as pa
import pyarrow.parquet as pq
from pathlib import Path

MODULE = Path(__file__).resolve().parents[2] / "scripts" / "prepare-ml-demo.py"
spec = importlib.util.spec_from_file_location("prepare_ml_demo", MODULE)
converter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(converter)


class ConverterTests(unittest.TestCase):
    def test_temporary_artifacts_validate_and_sanitize(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            timestamp_type = pa.timestamp("us", tz="UTC")
            recommendations = pa.table({
                "sourceNodeId": pa.array(["synthetic-friend-rec-v1:0"], type=pa.string()),
                "candidateNodeId": pa.array(["synthetic-friend-rec-v1:1"], type=pa.string()),
                "rank": pa.array([1], type=pa.int32()),
                "score": pa.array([0.75], type=pa.float64()),
                "modelVersion": pa.array(["friend-rec-logreg-c1-v1"], type=pa.string()),
                "computedAt": pa.array([datetime(2026, 1, 1, tzinfo=timezone.utc)], type=timestamp_type),
            })
            score_schema = pa.schema([
                ("actorId", pa.string()), ("evaluatedAt", timestamp_type),
                ("anomalyScore", pa.float64()), ("isAlert", pa.bool_()), ("modelVersion", pa.string()),
            ])
            score_rows = [
                ("synthetic-test-actor-001", datetime(2026, 1, 1, tzinfo=timezone.utc), -0.2, False, "isolation-forest-v1"),
                ("synthetic-test-actor-002", datetime(2026, 1, 2, tzinfo=timezone.utc), 0.8, True, "isolation-forest-v1"),
            ]
            scores = pa.Table.from_pylist([
                dict(zip(score_schema.names, row)) for row in score_rows
            ], schema=score_schema)
            alerts = scores.filter(pa.compute.equal(scores["isAlert"], True))
            rec_path, score_path, alert_path, metrics_path = (root / name for name in ("recommendations.parquet", "scores.parquet", "alerts.parquet", "metrics.json"))
            pq.write_table(recommendations, rec_path)
            pq.write_table(scores, score_path)
            pq.write_table(alerts, alert_path)
            metrics_path.write_text(json.dumps({
                "modelVersion": "isolation-forest-v1", "threshold": 0.1,
                "test": {"samples": 2, "alerts_count": 1, "confusion": {"tp": 1, "fp": 0, "tn": 1, "fn": 0}, "alert_rate": 0.5},
            }), encoding="utf-8")
            bundle = converter.build(rec_path, score_path, alert_path, metrics_path)
            self.assertEqual(bundle["schemaVersion"], 1)
            self.assertEqual(bundle["source"], "synthetic")
            self.assertEqual(bundle["evaluatedCount"], 2)
            self.assertEqual(len(bundle["alerts"]), 1)
            self.assertEqual(set(bundle["recommendations"][0]), {"sourceNodeId", "candidateNodeId", "rank", "score"})

            mismatched_alerts = pa.Table.from_pylist([dict(zip(score_schema.names, score_rows[0]))], schema=score_schema)
            pq.write_table(mismatched_alerts, alert_path)
            with self.assertRaisesRegex(ValueError, "exact alert filter"):
                converter.build(rec_path, score_path, alert_path, metrics_path)

    def test_rejects_bad_provenance_and_nonfinite_scores(self):
        self.assertFalse(converter.REC_ID.fullmatch("account:real-id"))
        self.assertFalse(converter.REC_ID.fullmatch("synthetic-friend-rec-v1:٠"))
        self.assertFalse(converter.ACTOR_ID.fullmatch("synthetic-other-actor-001"))
        with self.assertRaises(ValueError):
            converter.finite(float("nan"))
        with self.assertRaises(ValueError):
            converter.finite(1.01)

    def test_rejects_wrong_parquet_schema_and_never_overwrites_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            wrong = root / "wrong.parquet"
            pq.write_table(pa.table({"accountId": ["real-looking"]}), wrong)
            with self.assertRaisesRegex(ValueError, "schema"):
                converter.build(wrong, wrong, wrong, wrong)
            target = root / "bundle.json"
            target.write_text("preserve", encoding="utf-8")
            with self.assertRaises(FileExistsError):
                converter.write_bundle(target, b"replacement")
            self.assertEqual(target.read_text(encoding="utf-8"), "preserve")
            self.assertEqual(list(root.glob(".ml-demo-*")), [])


if __name__ == "__main__":
    unittest.main()
