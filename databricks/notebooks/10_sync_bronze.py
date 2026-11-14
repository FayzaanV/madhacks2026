# Databricks notebook source
# MAGIC %md
# MAGIC # 10 · Sync the Lakebase ledger → `bronze`
# MAGIC The ledger is registered in Unity Catalog as `the_curve_ledger`, so this is a plain Spark read.
# MAGIC Lakebase is the source of truth once seeded (it holds the simulated rows too), so each run
# MAGIC replaces the bronze tables with a fresh snapshot. Scheduled every 15 min and run after resolutions.

# COMMAND ----------

dbutils.widgets.text("catalog", "the_curve")
dbutils.widgets.text("ledger_catalog", "the_curve_ledger")
catalog = dbutils.widgets.get("catalog")
ledger = dbutils.widgets.get("ledger_catalog")

from pyspark.sql import functions as F

TABLES = {  # postgres table -> bronze table
    "users": "users_raw", "markets": "markets_raw", "outcomes": "outcomes_raw", "trades": "trades_raw",
    "resolutions": "resolutions_raw", "comments": "comments_raw", "disputes": "disputes_raw",
    "ai_questions": "ai_questions_raw",
    "sessions": "sessions_raw",
    "schools": "schools_raw",          # session_hash is dropped below; login_tokens are never synced
}
DROP_COLS = {"session_hash", "email"}
for pg, bronze in TABLES.items():
    df = spark.table(f"{ledger}.public.{pg}")
    df = df.drop(*[c for c in DROP_COLS if c in df.columns and pg in ("sessions", "login_tokens")])
    df = (df.withColumn("source", F.lit("lakebase"))
          .withColumn("ingested_at", F.current_timestamp()))
    for c, t in df.dtypes:  # Postgres timestamptz arrives as timestamp; keep bronze types stable
        if t.startswith("decimal"):
            df = df.withColumn(c, F.col(c).cast("double"))
    if "is_simulated" not in df.columns:
        df = df.withColumn("is_simulated", F.lit(False))
    (df.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{catalog}.bronze.{bronze}"))
    print(f"{ledger}.public.{pg} -> {catalog}.bronze.{bronze}: {df.count()} rows")
