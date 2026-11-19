#!/usr/bin/env python3
"""Build a private, synthetic-only ML demo bundle from the approved Parquet exports."""
import argparse
import json
import math
import os
import pyarrow as pa
import re
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

import pyarrow.parquet as pq

REC_ID = re.compile(r"synthetic-friend-rec-v1:(0|[1-9][0-9]*)\Z")
ACTOR_ID = re.compile(r"synthetic-test-actor-[0-9]{3}\Z")


def fail(message):
    raise ValueError(message)


def iso(value):
    if value.tzinfo is None or value.utcoffset() is None:
        fail("timestamp must include UTC timezone")
    if value.utcoffset().total_seconds() != 0:
        fail("timestamp must be UTC")
    return value.isoformat(timespec="microseconds").replace("+00:00", "Z")


def finite(value):
    number = float(value)
    if not math.isfinite(number) or not -1 <= number <= 1:
        fail("score or threshold outside finite [-1, 1] range")
    return number


def build(recommendations_path, scores_path, alerts_path, metrics_path):
    rec_table, score_table, alert_table = (pq.read_table(p) for p in
        (recommendations_path, scores_path, alerts_path))
    rec_types = [pa.string(), pa.string(), pa.int32(), pa.float64(), pa.string(), pa.timestamp("us", tz="UTC")]
    anomaly_types = [pa.string(), pa.timestamp("us", tz="UTC"), pa.float64(), pa.bool_(), pa.string()]
    if (rec_table.schema.names != list(("sourceNodeId", "candidateNodeId", "rank", "score", "modelVersion", "computedAt")) or
        [field.type for field in rec_table.schema] != rec_types or
        score_table.schema.names != ["actorId", "evaluatedAt", "anomalyScore", "isAlert", "modelVersion"] or
        alert_table.schema.names != score_table.schema.names or
        [field.type for field in score_table.schema] != anomaly_types or
        [field.type for field in alert_table.schema] != anomaly_types):
        fail("unexpected Parquet schema")
    rec_rows, score_rows, alert_rows = (t.to_pylist() for t in (rec_table, score_table, alert_table))
    if len(rec_rows) > 2000 or len(score_rows) > 1000 or len(alert_rows) > 1000:
        fail("row count exceeds bundle limits")
    metrics = json.loads(Path(metrics_path).read_text(encoding="utf-8"))
    if (not isinstance(metrics, dict) or not {"modelVersion", "threshold", "test"} <= set(metrics) or
        not isinstance(metrics["test"], dict)):
        fail("metrics schema mismatch")
    threshold = finite(metrics["threshold"])
    evaluated = metrics["test"].get("samples")
    if type(evaluated) is not int or evaluated != len(score_rows):
        fail("evaluation count mismatch")
    anomaly_version = metrics["modelVersion"]
    if not isinstance(anomaly_version, str) or not re.fullmatch(r"[A-Za-z0-9._-]{1,128}", anomaly_version):
        fail("missing anomaly model version")
    rec_version, computed_at = None, None
    sanitized_rec, seen, groups = [], set(), {}
    for row in rec_rows:
        if not REC_ID.fullmatch(row["sourceNodeId"]) or not REC_ID.fullmatch(row["candidateNodeId"]):
            fail("recommendation provenance namespace mismatch")
        if row["sourceNodeId"] == row["candidateNodeId"]:
            fail("self recommendation")
        if type(row["rank"]) is not int or not 1 <= row["rank"] <= 10:
            fail("invalid recommendation rank")
        score = finite(row["score"])
        if not 0 <= score <= 1:
            fail("recommendation score outside [0, 1] range")
        pair = (row["sourceNodeId"], row["candidateNodeId"])
        if pair in seen:
            fail("duplicate recommendation pair")
        seen.add(pair)
        groups.setdefault(row["sourceNodeId"], []).append(row["rank"])
        if rec_version is None:
            rec_version = row["modelVersion"]
            if not isinstance(rec_version, str) or not re.fullmatch(r"[A-Za-z0-9._-]{1,128}", rec_version):
                fail("invalid recommendation model version")
            computed_at = iso(row["computedAt"])
        if row["modelVersion"] != rec_version or iso(row["computedAt"]) != computed_at:
            fail("recommendation metadata mismatch")
        sanitized_rec.append({"sourceNodeId": pair[0], "candidateNodeId": pair[1], "rank": row["rank"], "score": score})
    if any(sorted(ranks) != list(range(1, len(ranks) + 1)) for ranks in groups.values()):
        fail("recommendation rank groups must be contiguous")
    sanitized_rec.sort(key=lambda r: (r["sourceNodeId"], r["rank"]))
    expected, expected_actor_ids = [], set()
    for row in score_rows:
        if not ACTOR_ID.fullmatch(row["actorId"]) or row["modelVersion"] != anomaly_version:
            fail("anomaly provenance/model mismatch")
        score = finite(row["anomalyScore"])
        evaluated_at = iso(row["evaluatedAt"])
        if row["actorId"] in expected_actor_ids:
            fail("duplicate score actor")
        expected_actor_ids.add(row["actorId"])
        if row["isAlert"] != (score >= threshold):
            fail("score/threshold alert mismatch")
        if row["isAlert"]:
            expected.append({"actorId": row["actorId"], "evaluatedAt": evaluated_at, "anomalyScore": score})
    expected.sort(key=lambda row: (row["evaluatedAt"], row["actorId"]))
    actual = []
    for row in alert_rows:
        if not ACTOR_ID.fullmatch(row["actorId"]) or row["modelVersion"] != anomaly_version or row["isAlert"] is not True:
            fail("alerts Parquet is not an exact alert filter")
        actual.append({"actorId": row["actorId"], "evaluatedAt": iso(row["evaluatedAt"]), "anomalyScore": finite(row["anomalyScore"])})
    actual.sort(key=lambda row: (row["evaluatedAt"], row["actorId"]))
    if actual != expected:
        fail("alerts Parquet differs from the exact score filter")
    if type(metrics["test"].get("alerts_count")) is not int or metrics["test"]["alerts_count"] != len(expected):
        fail("metrics alert count mismatch")
    confusion = metrics["test"].get("confusion")
    counts = [confusion.get(key) for key in ("tp", "fp", "tn", "fn")] if isinstance(confusion, dict) else []
    raw_alert_rate = metrics["test"].get("alert_rate")
    if isinstance(raw_alert_rate, bool) or not isinstance(raw_alert_rate, (int, float)):
        fail("invalid metrics alert rate")
    try:
        alert_rate = float(raw_alert_rate)
    except (TypeError, ValueError):
        alert_rate = math.nan
    if (len(counts) != 4 or any(type(count) is not int or count < 0 for count in counts) or
        sum(counts) != evaluated or confusion["tp"] + confusion["fp"] != len(expected) or
        not math.isfinite(alert_rate) or not math.isclose(alert_rate, len(expected) / evaluated if evaluated else 0, abs_tol=1e-12)):
        fail("metrics confusion/count/rate mismatch")
    return {
        "schemaVersion": 1, "source": "synthetic",
        "recommendationModelVersion": rec_version, "anomalyModelVersion": anomaly_version,
        "computedAt": computed_at, "recommendations": sanitized_rec,
        "threshold": threshold, "evaluatedCount": evaluated, "alerts": actual,
    }


def write_bundle(target, payload):
    target = Path(target).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".ml-demo-", dir=target.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, stat.S_IRUSR | stat.S_IWUSR)
        if os.name == "nt":
            account = subprocess.check_output(["whoami"], text=True, encoding="utf-8").strip()
            subprocess.run(
                ["icacls", temporary, "/inheritance:r", "/grant:r", f"{account}:(F)"],
                check=True, capture_output=True, text=True,
            )
        # Hard-link creation is atomic and fails rather than replacing an existing destination.
        os.link(temporary, target)
        os.unlink(temporary)
    except Exception:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--recommendations", required=True)
    parser.add_argument("--scores", required=True)
    parser.add_argument("--alerts", required=True)
    parser.add_argument("--metrics", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    payload = (json.dumps(build(args.recommendations, args.scores, args.alerts, args.metrics),
                          ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()
    write_bundle(args.output, payload)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"prepare-ml-demo: {error}", file=sys.stderr)
        sys.exit(2)
