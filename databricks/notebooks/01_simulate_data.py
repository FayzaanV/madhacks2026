# Databricks notebook source
# MAGIC %md
# MAGIC # 01 · Simulate campus data → `bronze`
# MAGIC ~2,000 students, 50 markets, ~19k trades with behavior archetypes (good, casual, bad, herd, troll).
# MAGIC Every row is `is_simulated = true`. Logic lives in `databricks/lib/simulate.py` (tested locally).

# COMMAND ----------

dbutils.widgets.text("catalog", "the_curve")
dbutils.widgets.text("seed", "42")
catalog = dbutils.widgets.get("catalog")
seed = int(dbutils.widgets.get("seed"))

import os
import sys

_nb = dbutils.notebook.entry_point.getDbutils().notebook().getContext().notebookPath().get()
NB_DIR = os.path.dirname(_nb if _nb.startswith("/Workspace") else "/Workspace" + _nb)
sys.path.insert(0, os.path.join(os.path.dirname(NB_DIR), "lib"))
import simulate  # noqa: E402

rows = simulate.simulate(seed=seed)
{k: len(v) for k, v in rows.items()}

# COMMAND ----------

from datetime import datetime, timezone

from pyspark.sql import types as T

TS, S, D, I, B = T.TimestampType(), T.StringType(), T.DoubleType(), T.IntegerType(), T.BooleanType()
SCHEMAS = {
    "users_raw": [("user_id", S), ("school_id", S), ("handle", S), ("email", S), ("major", S), ("dorm", S),
                  ("club", S), ("class_year", I), ("archetype", S), ("is_instructor", B), ("clout", D),
                  ("created_at", TS)],
    "markets_raw": [("market_id", S), ("school_id", S), ("course", S), ("question", S), ("market_type", S),
                    ("status", S), ("liquidity_b", D), ("creator_id", S), ("resolution_source", S),
                    ("created_at", TS), ("opens_at", TS), ("closes_at", TS)],
    "outcomes_raw": [("market_id", S), ("outcome_index", I), ("label", S), ("q_shares", D)],
    "trades_raw": [("trade_id", S), ("market_id", S), ("user_id", S), ("outcome_index", I), ("side", S),
                   ("clout_spent", D), ("shares", D), ("basis_change", D), ("price_before", D), ("post_price", D), ("prices_after", T.ArrayType(D)),
                   ("user_clout_at_trade", D), ("created_at", TS)],
    "resolutions_raw": [("market_id", S), ("winning_outcome_index", I), ("resolved_by", S), ("rationale", S),
                        ("resolved_at", TS), ("dispute_deadline", TS), ("final_at", TS), ("status", S)],
    "comments_raw": [("comment_id", S), ("market_id", S), ("user_id", S), ("body", S), ("created_at", TS)],
    "disputes_raw": [("dispute_id", S), ("market_id", S), ("user_id", S), ("reason", S), ("created_at", TS)],
    "schools_raw": [("school_id", S), ("name", S), ("short_name", S), ("domain", S), ("color", S), ("is_listed", B)],
}
ingested_at = datetime.now(timezone.utc)

for table, cols in SCHEMAS.items():
    fields = cols + [("is_simulated", B), ("source", S), ("ingested_at", TS)]
    schema = T.StructType([T.StructField(n, t, True) for n, t in fields])
    data = [tuple(r.get(n) for n, _ in cols) + (r.get("is_simulated", True), "simulation", ingested_at) for r in rows[table]]
    df = spark.createDataFrame(data, schema)
    (df.write.mode("overwrite").option("overwriteSchema", "true")
       .saveAsTable(f"{catalog}.bronze.{table}"))
    print(f"{catalog}.bronze.{table}: {df.count()} rows")
