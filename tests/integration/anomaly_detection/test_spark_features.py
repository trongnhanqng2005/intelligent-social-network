import json
import tempfile
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pyspark.sql import SparkSession

from anomaly_detection.workflow import FEATURES, run_features


class SparkFeatureIntegrationTests(unittest.TestCase):
    def test_feature_windows_failures_and_empty_actor(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            t = datetime(2026, 1, 2, tzinfo=timezone.utc)
            def stamp(value):
                return value.isoformat().replace("+00:00", "Z")

            events = []
            def add(minutes, event_type):
                events.append({
                    "eventId": str(uuid.uuid4()), "schemaVersion": 1, "eventType": event_type,
                    "occurredAt": stamp(t + timedelta(minutes=minutes)), "source": "synthetic-weylume-v1",
                    "actorId": "synthetic-a", "targetUserId": None,
                })
            add(-24 * 60, "POST_CREATED")
            add(-24 * 60 - 1, "POST_CREATED")
            add(-60, "POST_CREATED")
            add(-30, "POST_CREATED")
            add(0, "POST_CREATED")
            add(1, "POST_CREATED")
            add(-30, "SYNTHETIC_LOGIN_FAILED")
            add(-24 * 60, "SYNTHETIC_LOGIN_FAILED")
            (root / "events.jsonl").write_text("".join(json.dumps(row) + "\n" for row in events), encoding="utf-8")
            anchors = [{"actorId": "synthetic-a", "evaluatedAt": stamp(t)},
                       {"actorId": "synthetic-empty", "evaluatedAt": stamp(t)}]
            (root / "anchors.jsonl").write_text("".join(json.dumps(row) + "\n" for row in anchors), encoding="utf-8")
            run_features(root / "events.jsonl", root / "anchors.jsonl", root / "features")
            spark = SparkSession.builder.master("local[2]").appName("verify-anomaly-features").config(
                "spark.sql.session.timeZone", "UTC").getOrCreate()
            try:
                rows = spark.read.parquet(str(root / "features/features.parquet")).collect()
                by_actor = {row.actorId: row.asDict() for row in rows}
            finally:
                spark.stop()
            actor = by_actor["synthetic-a"]
            self.assertEqual(3, actor["24h_post_count"])
            self.assertEqual(2, actor["1h_post_count"])
            self.assertEqual(2, actor["24h_failed_login_count"])
            self.assertEqual(1, actor["1h_failed_login_count"])
            self.assertTrue(all(by_actor["synthetic-empty"][name] == 0 for name in FEATURES))


if __name__ == "__main__":
    unittest.main()
