# Proposed data and model lifecycle

The event, application-integrated feature-engineering and production-model requirements here are from the proposal and remain unimplemented. The standalone edge ETL produces synthetic graph layers and data-quality counts. A separate offline synthetic friend-link-prediction experiment now evaluates actual Gold Parquet; it is not a real-source dataset, production model, or accepted application feature.

## Event and data processing

Proposed inputs: selected public data, simulated activity events and application-generated activity. Suggested event fields are `eventId`, `userId`, `eventType`, `timestamp`, optional `sessionId`, optional `targetUserId`, and simulated-only `scenarioLabel`. A fixed random seed/configurable scenario proportions are proposed for reproducible synthetic generation. Never emit password/token data; distinguish simulated from application activity and minimize identifying information.

Proposed batch stages:

1. Preserve raw files/logs and source/load-time provenance in Bronze.
2. Validate schema, normalize identifiers/timestamps, deduplicate, handle missing values and quarantine invalid records into Silver.
3. Aggregate time-window and relationship features into Gold.
4. Track source, schema and transform versions to support reproducibility (the exact metadata contract remains to be designed).

## Friend recommendation — link prediction

Goal: rank non-friend user pairs likely to become friends. Proposed graph features are Common Neighbors, Jaccard, Adamic-Adar, Resource Allocation and degree. Common Neighbors is a baseline; Logistic Regression is the primary candidate; Random Forest is a comparison. Suggested output: Top-K candidates and score/model version/computed time; filter existing friendship, self-pairs and invalid/pending pairs before display.

The proposal identifies SNAP Facebook social circles as the main initial research graph (4,039 nodes / 88,234 edges stated in the proposal) and an edge-holdout evaluation because this static graph lacks activity timestamps. Split edges before computing features to avoid leakage. Compare with Precision@K, Recall@K, ROC-AUC and Average Precision. Dataset license, identity namespace/mapping, split strategy, negative sampling and candidate policy need review. The implemented offline evaluator uses synthetic Gold only. Its 2026-11-19 48-node/126-edge evaluation used an 88/12/12/14 observed/train-positive/validation-positive/test-positive split and 12/495/495 train/validation/test negatives; test had 21 positive endpoints. Logistic Regression selected C=1 and exceeded the common-neighbor baseline on this graph, but one small synthetic graph does not establish generalization. The [experiment README](../../friend_recommendation/README.md) records the numerical comparison, reproducibility evidence, and limitations; no SNAP or production result is claimed.

## Anomaly detection

Goal: score unusual user activity over windows such as one or 24 hours. Suggested features include login/failure counts, friend requests, post/comment counts, unique targets and activity burst ratio. Isolation Forest is the proposed unsupervised model, trained primarily on normal activity; simulated scenario labels are for evaluation, not model inputs. Hold out users or time ranges to limit leakage, select threshold on validation data, and report precision, recall, F1 and false-positive rate.

Suggested scenarios include ordinary activity, burst requests/comments/posts, repeated failed logins and sudden activity increases. Output is a score/time and administrator-review alert; no automatic account lock. Thresholds, calibration, window definitions, false-positive costs and human review policy remain undecided.

## Training, evaluation and serving

Proposed flow: deterministic input/split → feature generation → baseline/model training → leakage-aware validation/test → record metrics and model version → batch scoring → expose stored Top-K/alerts through an API after a stable contract exists. Metrics are research outputs, not software tests. The synthetic offline evaluator is experimental; no trained production artifact, inference endpoint or prediction integration exists. See the [recorded experiment status](../../friend_recommendation/README.md).

Optional reference sources from the proposal: [SNAP Facebook](https://snap.stanford.edu/data/egonets-Facebook.html), [SNAP Pokec](https://snap.stanford.edu/data/soc-pokec.html), [TwiBot-22](https://github.com/LuoUndergradXJTU/TwiBot-22), [Neo4j GDS link-prediction pipelines](https://neo4j.com/docs/graph-data-science/current/machine-learning/linkprediction-pipelines/link-prediction/), [PySpark DataFrame API](https://spark.apache.org/docs/latest/api/python/reference/pyspark.sql/index.html), [scikit-learn IsolationForest](https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.IsolationForest.html). Availability/licensing/access and versions must be rechecked before use.
