# Databricks notebook source
# MAGIC %md
# MAGIC # 10 · Sync the Lakebase ledger → `bronze`
# MAGIC The ledger is registered in Unity Catalog as `the_curve_ledger`, so this is a plain Spark read.
# MAGIC Lakebase is the source of truth once seeded (it holds the simulated rows too).
# MAGIC - **Append-only tables** (`trades`, `ai_questions`) are synced **incrementally**: rows newer than the latest
# MAGIC   `created_at` already in bronze (minus a 1h overlap for late commits) are MERGEd on their id, so bronze keeps
# MAGIC   every row ever seen and each run only moves the new ones.
# MAGIC - **Mutable tables** (users' balances, market status, soft-deleted comments, ...) are small and replaced with a snapshot.
# MAGIC - `full_refresh=true`, a missing bronze table, or a schema change falls back to a full overwrite.
# MAGIC Scheduled every 15 min and started by the app after each resolution.

# COMMAND ----------

dbutils.widgets.text("catalog", "the_curve")
dbutils.widgets.text("ledger_catalog", "the_curve_ledger")
dbutils.widgets.text("full_refresh", "false")
catalog = dbutils.widgets.get("catalog")
ledger = dbutils.widgets.get("ledger_catalog")
full_refresh = dbutils.widgets.get("full_refresh").lower() == "true"

from delta.tables import DeltaTable
from pyspark.sql import functions as F

TABLES = {  # postgres table -> bronze table
    "users": "users_raw", "markets": "markets_raw", "outcomes": "outcomes_raw", "trades": "trades_raw",
    "resolutions": "resolutions_raw", "comments": "comments_raw", "disputes": "disputes_raw",
    "ai_questions": "ai_questions_raw",
    "sessions": "sessions_raw",
    "schools": "schools_raw",          # session_hash is dropped below; login_tokens are never synced
    "course_staff": "course_staff_raw",
}
APPEND_ONLY = {"trades": "trade_id", "ai_questions": "question_id"}  # table -> primary key
OVERLAP = "INTERVAL 1 HOUR"
# Never leave Lakebase: secrets/PII for sessions, and avatar image bytes (no analytics use; keeps bronze small).
DROP_COLS = {"sessions": {"session_hash", "email"}, "users": {"avatar", "avatar_type"}}


def source(pg):
    df = spark.table(f"{ledger}.public.{pg}")
    df = df.drop(*[c for c in DROP_COLS.get(pg, ()) if c in df.columns])
    df = (df.withColumn("source", F.lit("lakebase"))
          .withColumn("ingested_at", F.current_timestamp()))
    for c, t in df.dtypes:  # Postgres timestamptz arrives as timestamp; keep bronze types stable
        if t.startswith("decimal"):
            df = df.withColumn(c, F.col(c).cast("double"))
    if "is_simulated" not in df.columns:
        df = df.withColumn("is_simulated", F.lit(False))
    return df


for pg, bronze in TABLES.items():
    if not spark.catalog.tableExists(f"{ledger}.public.{pg}"):
        print(f"skip {pg}: not in the ledger yet (apply db/schema.sql)")
        continue
    target = f"{catalog}.bronze.{bronze}"
    df = source(pg)
    key = APPEND_ONLY.get(pg)
    incremental = (key and not full_refresh and spark.catalog.tableExists(target)
                   and set(spark.table(target).columns) == set(df.columns))
    if incremental:
        since = spark.table(target).agg(F.max("created_at")).first()[0]
        new = df if since is None else df.where(F.col("created_at") >= F.lit(since) - F.expr(OVERLAP))
        (DeltaTable.forName(spark, target).alias("b")
         .merge(new.alias("s"), f"b.{key} = s.{key}")
         .whenNotMatchedInsertAll()
         .execute())
        print(f"{ledger}.public.{pg} -> {target}: merged {new.count()} recent rows (incremental)")
    else:
        df.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(target)
        print(f"{ledger}.public.{pg} -> {target}: {df.count()} rows (snapshot)")
