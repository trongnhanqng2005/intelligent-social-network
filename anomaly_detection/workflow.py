from __future__ import annotations

import argparse
import json
import math
import os
import random
import re
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

SEED = 20261119
MODEL_VERSION = "weylume-isolation-forest-v1"
EVENT_TYPES = (
    "AUTH_REGISTERED", "AUTH_LOGIN_SUCCEEDED", "AUTH_LOGOUT",
    "FRIEND_REQUEST_CREATED", "FRIEND_REQUEST_ACCEPTED", "FRIEND_REQUEST_REJECTED",
    "FRIEND_REQUEST_CANCELLED", "FRIENDSHIP_REMOVED", "POST_CREATED", "POST_UPDATED",
    "POST_DELETED", "POST_LIKED", "POST_UNLIKED", "COMMENT_CREATED", "COMMENT_UPDATED",
    "COMMENT_DELETED", "SYNTHETIC_LOGIN_FAILED",
)
FAMILIES = ("auth", "friendship", "post", "comment")
FEATURES = tuple(f"{window}_{family}_count" for window in ("24h", "1h") for family in FAMILIES) + (
    "24h_failed_login_count", "1h_failed_login_count",
    "24h_distinct_targets", "1h_distinct_targets", "recent_activity_vs_prior_23h",
)
EVENT_FIELDS = ("eventId", "schemaVersion", "eventType", "occurredAt", "source", "actorId", "targetUserId")
ID_RE = re.compile(r"^synthetic-[a-z0-9-]+$")
LABELS = {"normal": 0, "anomaly": 1}


def _publish(output: Path, writer):
    if os.path.lexists(output):
        raise FileExistsError(f"Output directory must be new: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".weylume-", dir=output.parent) as temp:
        payload = Path(temp) / "payload"
        result = writer(payload)
        if os.path.lexists(output):
            raise FileExistsError(f"Output directory must be new: {output}")
        os.rename(payload, output)
        return result


def _utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() != timedelta(0):
        raise ValueError("timestamps must be UTC and timezone-aware")
    return parsed.astimezone(timezone.utc)


def _write_jsonl(path: Path, rows):
    path.write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in rows),
                    encoding="utf-8", newline="\n")


def generate(output: Path):
    rng = random.Random(SEED)
    origin = datetime(2026, 1, 1, tzinfo=timezone.utc)
    events, anchors, labels = [], [], []
    event_number = 0
    # Cohorts are temporally separated by two days and have disjoint actors.
    cohorts = (("train", 96, 0), ("validation", 64, 48), ("test", 64, 96))
    for split, count, offset in cohorts:
        for index in range(count):
            actor = f"synthetic-{split}-actor-{index:03d}"
            evaluated = origin + timedelta(hours=offset + 24)
            anchor = {"actorId": actor, "evaluatedAt": evaluated.isoformat().replace("+00:00", "Z")}
            anchors.append(anchor)
            scenario = "normal"
            intensity = 1
            draw = rng.random()
            if split != "train" and draw < .18:
                scenario, intensity = "friend_burst", rng.randint(3, 8)
            elif split != "train" and draw < .34:
                scenario, intensity = "content_burst", rng.randint(3, 8)
            elif split != "train" and draw < .47:
                scenario, intensity = "failed_login", rng.randint(3, 10)
            elif split != "train" and draw < .59:
                scenario, intensity = "abrupt_shift", rng.randint(3, 8)
            labels.append({"actorId": actor, "evaluatedAt": anchor["evaluatedAt"], "split": split,
                           "label": "anomaly" if scenario != "normal" else "normal",
                           "scenario": scenario})
            n = 0 if scenario == "normal" and index % 13 == 0 else rng.randint(2, 8)
            if scenario == "normal" and index % 11 == 0:
                # Isolated failures occur among ordinary activity, not only bursts.
                n = max(n, 1)
            burst_family = {"friend_burst": "friendship", "content_burst": "post",
                            "failed_login": "auth", "abrupt_shift": "comment"}.get(scenario)
            for j in range(n):
                family = ("auth" if scenario == "normal" and index % 11 == 0 and j == 0 else
                          burst_family if burst_family and (scenario != "abrupt_shift" or j == n - 1) and (j == 0 or scenario == "abrupt_shift") else
                          rng.choice(("auth", "friendship", "post", "comment")))
                event_type = {"auth": "AUTH_LOGIN_SUCCEEDED", "friendship": "FRIEND_REQUEST_CREATED",
                              "post": "POST_CREATED", "comment": "COMMENT_CREATED"}[family]
                count_events = intensity if scenario in ("friend_burst", "content_burst") and (
                    (scenario == "friend_burst" and family == "friendship") or
                    (scenario == "content_burst" and family in ("post", "comment"))) else 1
                if scenario == "failed_login" and family == "auth":
                    event_type, count_events = "SYNTHETIC_LOGIN_FAILED", intensity
                elif scenario == "normal" and index % 11 == 0 and j == 0 and family == "auth":
                    event_type = "SYNTHETIC_LOGIN_FAILED"
                if scenario == "abrupt_shift" and j == n - 1:
                    count_events = intensity
                for burst_index in range(count_events):
                    event_number += 1
                    occurred = evaluated - timedelta(minutes=(rng.randint(1, 45) if scenario != "normal" and family == burst_family else rng.randint(1, 1439)))
                    target = f"synthetic-target-{rng.randrange(40):03d}" if family != "auth" else None
                    events.append({
                        "eventId": str(uuid.uuid5(uuid.NAMESPACE_URL, f"weylume:{event_number}")),
                        "schemaVersion": 1, "eventType": event_type,
                        "occurredAt": occurred.isoformat().replace("+00:00", "Z"),
                        "source": "synthetic-weylume-v1", "actorId": actor, "targetUserId": target,
                    })
    events.sort(key=lambda row: row["occurredAt"])
    def write(payload):
        payload.mkdir()
        _write_jsonl(payload / "events.jsonl", events)
        _write_jsonl(payload / "anchors.jsonl", anchors)
        _write_jsonl(payload / "labels.jsonl", labels)
        return {"events": len(events), "anchors": len(anchors), "labels": len(labels)}
    return _publish(output, write)


def read_inputs(events_path: Path, anchors_path: Path):
    events = [json.loads(line) for line in events_path.read_text(encoding="utf-8").splitlines() if line]
    anchors = [json.loads(line) for line in anchors_path.read_text(encoding="utf-8").splitlines() if line]
    ids = set()
    for row in events:
        if set(row) != set(EVENT_FIELDS) or row["schemaVersion"] != 1 or row["source"] != "synthetic-weylume-v1":
            raise ValueError("event schema/provenance invalid")
        if not ID_RE.fullmatch(row["actorId"]) or (row["targetUserId"] is not None and not ID_RE.fullmatch(row["targetUserId"])):
            raise ValueError("only synthetic-prefixed IDs are allowed")
        try:
            uuid_value = uuid.UUID(row["eventId"])
        except (ValueError, AttributeError, TypeError):
            uuid_value = None
        if (row["eventType"] not in EVENT_TYPES or uuid_value is None
                or str(uuid_value) != row["eventId"]):
            raise ValueError("event type or UUID eventId invalid")
        row["occurredAt"] = _utc(row["occurredAt"])
        if row["eventId"] in ids:
            raise ValueError("duplicate eventId")
        ids.add(row["eventId"])
    seen = set()
    for row in anchors:
        if set(row) != {"actorId", "evaluatedAt"} or not ID_RE.fullmatch(row["actorId"]):
            raise ValueError("anchor schema/identity invalid")
        row["evaluatedAt"] = _utc(row["evaluatedAt"])
        if row["actorId"] in seen:
            raise ValueError("duplicate anchor actor")
        seen.add(row["actorId"])
    actors = seen
    if any(row["actorId"] not in actors for row in events):
        raise ValueError("event actor has no anchor")
    if not anchors:
        raise ValueError("anchors must not be empty")
    return events, anchors


def _family(event_type):
    if event_type.startswith("AUTH_") or event_type == "SYNTHETIC_LOGIN_FAILED":
        return "auth"
    if event_type.startswith(("FRIEND_", "FRIENDSHIP_")):
        return "friendship"
    if event_type.startswith("POST_"):
        return "post"
    return "comment"


def run_features(events_path: Path, anchors_path: Path, output: Path):
    def write(payload):
        from pyspark.sql import SparkSession, functions as F, types as T
        events, anchors = read_inputs(events_path, anchors_path)
        spark = (SparkSession.builder.master("local[2]").appName("weylume-anomaly-v1")
                 .config("spark.sql.session.timeZone", "UTC").config("spark.sql.shuffle.partitions", "2")
                 .config("spark.sql.parquet.outputTimestampType", "TIMESTAMP_MICROS").getOrCreate())
        try:
            event_schema = T.StructType([T.StructField("eventId", T.StringType(), False), T.StructField("schemaVersion", T.IntegerType(), False), T.StructField("eventType", T.StringType(), False), T.StructField("occurredAt", T.TimestampType(), False), T.StructField("source", T.StringType(), False), T.StructField("actorId", T.StringType(), False), T.StructField("targetUserId", T.StringType(), True)])
            anchor_schema = T.StructType([T.StructField("actorId", T.StringType(), False), T.StructField("evaluatedAt", T.TimestampType(), False)])
            ev = spark.createDataFrame([{**e, "occurredAt": e["occurredAt"]} for e in events], event_schema)
            an = spark.createDataFrame([{**a, "evaluatedAt": a["evaluatedAt"]} for a in anchors], anchor_schema)
            joined = (an.alias("a").join(
                ev.alias("e"),
                (F.col("a.actorId") == F.col("e.actorId")) &
                (F.col("e.occurredAt") >= F.col("a.evaluatedAt") - F.expr("INTERVAL 24 HOURS")) &
                (F.col("e.occurredAt") < F.col("a.evaluatedAt")), "left"))
            family = (F.when(F.col("e.eventType").startswith("AUTH_") |
                             (F.col("e.eventType") == "SYNTHETIC_LOGIN_FAILED"), "auth")
                      .when(F.col("e.eventType").startswith("FRIEND_") |
                            F.col("e.eventType").startswith("FRIENDSHIP_"), "friendship")
                      .when(F.col("e.eventType").startswith("POST_"), "post").otherwise("comment"))
            enriched = joined.withColumn("_family", family).withColumn(
                "_recent", F.col("e.occurredAt") >= F.col("a.evaluatedAt") - F.expr("INTERVAL 1 HOUR"))
            expressions = []
            for w in ("24h", "1h"):
                for f in FAMILIES:
                    condition = F.col("_family") == f
                    if w == "1h":
                        condition = condition & F.col("_recent")
                    expressions.append(F.sum(F.when(F.col("e.eventId").isNotNull() & condition, 1).otherwise(0)).cast("double").alias(f"{w}_{f}_count"))
            for w in ("24h", "1h"):
                condition = F.col("e.eventType") == "SYNTHETIC_LOGIN_FAILED"
                if w == "1h":
                    condition = condition & F.col("_recent")
                expressions.append(F.sum(F.when(F.col("e.eventId").isNotNull() & condition, 1).otherwise(0)).cast("double").alias(f"{w}_failed_login_count"))
            expressions.extend([
                F.countDistinct(F.when(F.col("e.targetUserId").isNotNull(), F.col("e.targetUserId"))).cast("double").alias("24h_distinct_targets"),
                F.countDistinct(F.when(F.col("_recent") & F.col("e.targetUserId").isNotNull(), F.col("e.targetUserId"))).cast("double").alias("1h_distinct_targets"),
            ])
            result = enriched.groupBy(F.col("a.actorId").alias("actorId"), F.col("a.evaluatedAt").alias("evaluatedAt")).agg(*expressions)
            prior = sum(F.col(f"24h_{f}_count") for f in FAMILIES) - sum(F.col(f"1h_{f}_count") for f in FAMILIES)
            recent = sum(F.col(f"1h_{f}_count") for f in FAMILIES)
            result = result.withColumn("recent_activity_vs_prior_23h", recent / F.greatest(prior / F.lit(23.0), F.lit(1.0)))
            result = result.select("actorId", "evaluatedAt", *FEATURES)
            payload.mkdir()
            result.write.mode("errorifexists").option("compression", "snappy").parquet(str(payload / "features.parquet"))
            return {"features": list(FEATURES)}
        finally:
            spark.stop()
    return _publish(output, write)


def metrics_for(y_true, scores, threshold):
    import numpy as np
    from sklearn.metrics import confusion_matrix, f1_score

    y = np.asarray(y_true, dtype=np.int8)
    alerts = np.asarray(scores) >= threshold
    tn, fp, fn, tp = confusion_matrix(y, alerts, labels=[0, 1]).ravel()
    return {"precision": float(tp / (tp + fp)) if tp + fp else 0.0,
            "recall": float(tp / (tp + fn)) if tp + fn else 0.0,
            "f1": float(f1_score(y, alerts, zero_division=0)),
            "false_positive_rate": float(fp / (fp + tn)) if fp + tn else 0.0,
            "alerts_count": int(alerts.sum()), "alert_rate": float(alerts.mean()) if len(alerts) else 0.0,
            "confusion": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
            "samples": int(len(y))}


def evaluate(features_path: Path, labels_path: Path, output: Path):
    def write(payload):
        import pyarrow as pa
        import pyarrow.parquet as pq
        import numpy as np
        from sklearn.ensemble import IsolationForest
        from sklearn.metrics import f1_score

        table = pq.read_table(features_path)
        feature_schema = pa.schema([("actorId", pa.string()), ("evaluatedAt", pa.timestamp("us", tz="UTC"))] + [(name, pa.float64()) for name in FEATURES])
        expected = [(field.name, field.type) for field in feature_schema]
        actual = [(field.name, field.type) for field in table.schema]
        if actual != expected:
            raise ValueError("feature Parquet schema mismatch")
        if any(table[name].null_count for name in table.column_names):
            raise ValueError("null feature field")
        if any(v is None or not math.isfinite(v) for name in FEATURES for v in table[name].to_pylist()):
            raise ValueError("non-finite feature")
        labels = [json.loads(line) for line in labels_path.read_text(encoding="utf-8").splitlines() if line]
        feature_rows = table.to_pylist()
        labels_by_key = {}
        actors_by_split = {}
        for row in labels:
            if (set(row) != {"actorId", "evaluatedAt", "split", "label", "scenario"}
                    or row["label"] not in LABELS or row["split"] not in ("train", "validation", "test")
                    or not ID_RE.fullmatch(row["actorId"])):
                raise ValueError("label schema/value invalid")
            key = (row["actorId"], _utc(row["evaluatedAt"]))
            if key in labels_by_key:
                raise ValueError("duplicate label identity/time")
            labels_by_key[key] = row
            actors_by_split.setdefault(row["split"], set()).add(row["actorId"])
        time_blocks = {split: [_utc(r["evaluatedAt"]) for r in labels if r["split"] == split]
                       for split in ("train", "validation", "test")}
        if any(not time_blocks[s] for s in time_blocks):
            raise ValueError("all chronological cohorts are required")
        if not (min(time_blocks["validation"]) - max(time_blocks["train"]) >= timedelta(hours=24)
                and min(time_blocks["test"]) - max(time_blocks["validation"]) >= timedelta(hours=24)
                and all(max(block) - min(block) < timedelta(hours=24) for block in time_blocks.values())):
            raise ValueError("cohort anchor blocks must be chronological and nonoverlapping")
        if any(actors_by_split.get(a, set()) & actors_by_split.get(b, set())
               for a, b in (("train", "validation"), ("train", "test"), ("validation", "test"))):
            raise ValueError("cohort actors must be disjoint")
        keys = [(r["actorId"], r["evaluatedAt"]) for r in feature_rows]
        if len(keys) != len(set(keys)) or len({r["actorId"] for r in feature_rows}) != len(feature_rows) or set(keys) != set(labels_by_key):
            raise ValueError("features must match labels exactly by actor and UTC time")
        rows = sorted(zip(feature_rows, [labels_by_key[k] for k in keys]), key=lambda pair: (pair[0]["actorId"], pair[0]["evaluatedAt"]))
        train = [(x, y) for x, y in rows if y["split"] == "train" and y["label"] == "normal"]
        val = [(x, y) for x, y in rows if y["split"] == "validation"]
        test = [(x, y) for x, y in rows if y["split"] == "test"]
        if len(train) < 2 or not val or not test or {y["label"] for _, y in val} != {"normal", "anomaly"} or {y["label"] for _, y in test} != {"normal", "anomaly"}:
            raise ValueError("train normals, validation, and test cohorts are required")
        matrix = lambda subset: np.asarray([[r[name] for name in FEATURES] for r, _ in subset], dtype=np.float64)
        model = IsolationForest(random_state=SEED, n_estimators=200, contamination="auto", n_jobs=1)
        model.fit(matrix(train))
        val_scores = -model.decision_function(matrix(val))
        val_y = np.asarray([LABELS[y["label"]] for _, y in val])
        candidates = sorted(set(float(s) for s in val_scores) | {math.nextafter(max(val_scores), math.inf)}, reverse=True)
        choices = [(float(f1_score(val_y, val_scores >= t, zero_division=0)),
                    -metrics_for(val_y, val_scores, t)["false_positive_rate"], t, t) for t in candidates]
        threshold = max(choices)[-1]
        test_x, test_y = matrix(test), np.asarray([LABELS[y["label"]] for _, y in test])
        scores = -model.decision_function(test_x)
        test_metrics = metrics_for(test_y, scores, threshold)
        val_metrics = metrics_for(val_y, val_scores, threshold)
        payload.mkdir()
        SCORE_SCHEMA = pa.schema([("actorId", pa.string()), ("evaluatedAt", pa.timestamp("us", tz="UTC")),
                                  ("anomalyScore", pa.float64()), ("isAlert", pa.bool_()), ("modelVersion", pa.string())])
        output_rows = [{"actorId": x["actorId"], "evaluatedAt": x["evaluatedAt"],
                        "anomalyScore": float(score), "isAlert": bool(score >= threshold),
                        "modelVersion": MODEL_VERSION}
                       for (x, _), score in zip(test, scores)]
        score_table = pa.Table.from_pylist(output_rows, schema=SCORE_SCHEMA)
        if any(not math.isfinite(v) for v in score_table["anomalyScore"].to_pylist()):
            raise ValueError("non-finite anomaly score")
        pq.write_table(score_table, payload / "scores.parquet", compression="snappy")
        pq.write_table(score_table.filter(pa.array(score_table["isAlert"].to_pylist())),
                       payload / "alerts.parquet", compression="snappy")
        report = {"modelVersion": MODEL_VERSION, "seed": SEED, "features": list(FEATURES),
                  "training_samples": len(train), "validation_samples": len(val), "test_samples": len(test),
                  "threshold": threshold, "validation": val_metrics, "test": test_metrics}
        (payload / "metrics.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n",
                                               encoding="utf-8", newline="\n")
        return report
    return _publish(output, write)


def main():
    parser = argparse.ArgumentParser(description="Synthetic-only Weylume offline anomaly detection MVP")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("generate",):
        p = sub.add_parser(name)
        p.add_argument("--output-dir", type=Path, required=True)
    p = sub.add_parser("features")
    p.add_argument("--events", type=Path, required=True)
    p.add_argument("--anchors", type=Path, required=True)
    p.add_argument("--output-dir", type=Path, required=True)
    p = sub.add_parser("evaluate")
    p.add_argument("--features", type=Path, required=True)
    p.add_argument("--labels", type=Path, required=True)
    p.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    result = (generate(args.output_dir) if args.command == "generate" else
              run_features(args.events, args.anchors, args.output_dir) if args.command == "features" else
              evaluate(args.features, args.labels, args.output_dir))
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
