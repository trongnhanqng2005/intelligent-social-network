import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from anomaly_detection.workflow import (
    FEATURES, evaluate, generate, metrics_for, read_inputs,
)


class WorkflowTests(unittest.TestCase):
    def test_seeded_generation_and_separate_labels(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            generate(root / "one")
            generate(root / "two")
            for name in ("events.jsonl", "anchors.jsonl", "labels.jsonl"):
                self.assertEqual((root / "one" / name).read_bytes(), (root / "two" / name).read_bytes())
            anchors = [json.loads(line) for line in (root / "one/anchors.jsonl").read_text().splitlines()]
            self.assertEqual(224, len(anchors))
            self.assertEqual({"actorId", "evaluatedAt"}, set(anchors[0]))
            labels = [json.loads(line) for line in (root / "one/labels.jsonl").read_text().splitlines()]
            scenarios = {r["scenario"] for r in labels}
            self.assertTrue({"friend_burst", "content_burst", "failed_login", "abrupt_shift"} <= scenarios)
            event_rows = [json.loads(line) for line in (root / "one/events.jsonl").read_text().splitlines()]
            for label in labels:
                if label["scenario"] != "normal":
                    anchor = datetime.fromisoformat(label["evaluatedAt"].replace("Z", "+00:00"))
                    own = [e for e in event_rows if e["actorId"] == label["actorId"]]
                    self.assertTrue(any(0 < (anchor - datetime.fromisoformat(e["occurredAt"].replace("Z", "+00:00"))).total_seconds() <= 45 * 60 for e in own))

    def test_read_inputs_rejects_duplicate_anchor_actors_and_unknown_event_actors(self):
        at = "2026-01-02T00:00:00Z"
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            event = {"eventId": "00000000-0000-0000-0000-000000000001", "schemaVersion": 1,
                     "eventType": "POST_CREATED", "occurredAt": at, "source": "synthetic-weylume-v1",
                     "actorId": "synthetic-a", "targetUserId": None}
            (root / "events").write_text(json.dumps(event) + "\n")
            (root / "anchors").write_text(json.dumps({"actorId": "synthetic-a", "evaluatedAt": at}) + "\n" +
                                          json.dumps({"actorId": "synthetic-a", "evaluatedAt": at}) + "\n")
            with self.assertRaisesRegex(ValueError, "duplicate anchor"):
                read_inputs(root / "events", root / "anchors")
            (root / "anchors").write_text(json.dumps({"actorId": "synthetic-b", "evaluatedAt": at}) + "\n")
            with self.assertRaisesRegex(ValueError, "event actor"):
                read_inputs(root / "events", root / "anchors")

    def test_metrics(self):
        report = metrics_for([0, 0, 1, 1], [0.1, 0.8, 0.7, 0.9], 0.7)
        self.assertEqual({"tn": 1, "fp": 1, "fn": 0, "tp": 2}, report["confusion"])
        self.assertEqual(1.0, report["recall"])
        self.assertEqual(0.5, report["false_positive_rate"])

    def test_evaluate_schemas_alert_filter_and_cohort_join(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            generate(root / "generated")
            anchors = [json.loads(x) for x in (root / "generated/anchors.jsonl").read_text().splitlines()]
            rows = []
            for i, a in enumerate(anchors):
                row = {"actorId": a["actorId"], "evaluatedAt": datetime.fromisoformat(a["evaluatedAt"].replace("Z", "+00:00"))}
                row.update({f: float((i * (j + 3)) % 7) for j, f in enumerate(FEATURES)})
                rows.append(row)
            pq.write_table(pa.Table.from_pylist(rows), root / "features.parquet")
            result = evaluate(root / "features.parquet", root / "generated/labels.jsonl", root / "out")
            scores = pq.read_table(root / "out/scores.parquet")
            alerts = pq.read_table(root / "out/alerts.parquet")
            self.assertEqual(["actorId", "evaluatedAt", "anomalyScore", "isAlert", "modelVersion"], scores.column_names)
            self.assertEqual(result["test_samples"], scores.num_rows)
            self.assertEqual(scores.filter(pa.array(scores["isAlert"].to_pylist())).to_pylist(), alerts.to_pylist())
            self.assertNotIn("label", scores.column_names)

    def test_spark_like_arrow_schema_ignores_nullability_and_metadata(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            generate(root / "generated")
            anchors = [json.loads(line) for line in (root / "generated/anchors.jsonl").read_text().splitlines()]
            rows = [{"actorId": a["actorId"], "evaluatedAt": datetime.fromisoformat(a["evaluatedAt"].replace("Z", "+00:00")),
                     **{f: float(i % 7) for f in FEATURES}} for i, a in enumerate(anchors)]
            schema = pa.schema([pa.field("actorId", pa.string(), nullable=False, metadata={b"spark": b"true"}),
                                pa.field("evaluatedAt", pa.timestamp("us", tz="UTC"), nullable=False)] +
                               [pa.field(f, pa.float64(), nullable=False, metadata={b"origin": b"spark"}) for f in FEATURES],
                               metadata={b"schema": b"spark"})
            pq.write_table(pa.Table.from_pylist(rows, schema=schema), root / "features.parquet")
            result = evaluate(root / "features.parquet", root / "generated/labels.jsonl", root / "out")
            self.assertEqual(64, result["test_samples"])


if __name__ == "__main__":
    unittest.main()
