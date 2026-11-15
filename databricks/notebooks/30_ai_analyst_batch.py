# Databricks notebook source
# MAGIC %md
# MAGIC # 30 · AI market analyst (batch) → `gold.market_ai_insights`
# MAGIC For the 20 busiest live markets without a fresh (<2h) insight, builds a context (question, crowd vs Smart Money, recent trades, top comments)
# MAGIC and asks a Foundation Model through **`ai_query`** for a structured insight. Each market's
# MAGIC prompt and answer are also logged as an **MLflow trace** so the team can inspect AI behavior.
# MAGIC The analyst explains; it never tells anyone what to bet and never trades.

# COMMAND ----------

# MAGIC %pip install -q "mlflow>=3.1"
# MAGIC %restart_python

# COMMAND ----------

dbutils.widgets.text("catalog", "the_curve")
dbutils.widgets.text("ai_model", "databricks-meta-llama-3-3-70b-instruct")
catalog = dbutils.widgets.get("catalog")
model = dbutils.widgets.get("ai_model")

SYSTEM = """You are Yomi's market analyst for a college prediction market (students from many universities; these markets are about UW-Madison) where students bet
reputation points called Clout (never money). Explain the market; do not tell anyone what to bet.
Never discuss or speculate about individual students. All data shown is SIMULATED; say so if relevant.
Use only the data provided. Prices are probabilities (0-1). "Smart Money" is a Clout-weighted price that
counts only users with positive Clout. Be concise and concrete, like a sharp sports analyst."""

# COMMAND ----------

# Compute budget: only the busiest live markets, and skip any with an insight from the last 2 hours. One ai_query
# per market per run used to cover every live market (~230 with sports) and helped exhaust the Free Edition quota.
MAX_MARKETS = 20
insights_table = f"{catalog}.gold.market_ai_insights"
fresh_filter = (
    f"AND m.market_id NOT IN (SELECT market_id FROM {insights_table} WHERE generated_at > current_timestamp() - INTERVAL 2 HOURS)"
    if spark.catalog.tableExists(insights_table) else ""
)

spark.sql(f"""
CREATE OR REPLACE TEMP VIEW analyst_context AS
WITH live AS (
  SELECT m.market_id, m.course, m.question, m.market_type, m.closes_at, m.resolution_source
  FROM {catalog}.silver.markets m
  LEFT JOIN (SELECT market_id, COUNT(*) AS n FROM {catalog}.silver.trades_enriched
             WHERE created_at > current_timestamp() - INTERVAL 24 HOURS GROUP BY market_id) a USING (market_id)
  WHERE m.status = 'live' AND m.closes_at > current_timestamp() AND m.group_id IS NULL {fresh_filter}  -- never private group markets
  ORDER BY COALESCE(a.n, 0) DESC
  LIMIT {MAX_MARKETS}
), prices AS (
  SELECT market_id,
         TO_JSON(COLLECT_LIST(NAMED_STRUCT('outcome', label, 'crowd', ROUND(crowd_price, 3),
                                           'smart_money', ROUND(smart_price, 3)))) AS prices_json
  FROM {catalog}.gold.market_smart_money GROUP BY market_id
), recent AS (
  SELECT market_id, COUNT(*) AS trades_24h, ROUND(SUM(clout_spent), 1) AS clout_24h
  FROM {catalog}.silver.trades_enriched
  WHERE created_at >= (SELECT MAX(created_at) FROM {catalog}.silver.trades_enriched) - INTERVAL 24 HOURS
  GROUP BY market_id
), moves AS (
  SELECT market_id, MIN_BY(crowd_price, created_at) AS first_price, MAX_BY(crowd_price, created_at) AS last_price
  FROM {catalog}.gold.market_price_history WHERE outcome_index = 0 GROUP BY market_id
), cmts AS (
  SELECT market_id, TO_JSON(SLICE(COLLECT_LIST(body), 1, 8)) AS comments_json
  FROM {catalog}.bronze.comments_raw GROUP BY market_id
)
SELECT l.*, p.prices_json, COALESCE(r.trades_24h, 0) AS trades_24h, COALESCE(r.clout_24h, 0) AS clout_24h,
       ROUND(mv.first_price, 3) AS first_price_outcome0, ROUND(mv.last_price, 3) AS last_price_outcome0,
       COALESCE(c.comments_json, '[]') AS comments_json
FROM live l
LEFT JOIN prices p USING (market_id) LEFT JOIN recent r USING (market_id)
LEFT JOIN moves mv USING (market_id) LEFT JOIN cmts c USING (market_id)
""")
display(spark.table("analyst_context").limit(5))

# COMMAND ----------

RESPONSE_FORMAT = """{
  "type": "json_schema",
  "json_schema": {
    "name": "market_insight",
    "schema": {
      "type": "object",
      "properties": {
        "summary": {"type": "string"},
        "why_price_moved": {"type": "string"},
        "crowd_vs_smart_money": {"type": "string"},
        "comment_sentiment": {"type": "string"},
        "mispricing_flag": {"type": "boolean"},
        "confidence": {"type": "string", "enum": ["low", "medium", "high"]}
      },
      "required": ["summary", "why_price_moved", "crowd_vs_smart_money", "comment_sentiment",
                   "mispricing_flag", "confidence"]
    },
    "strict": true
  }
}"""

prompt_sql = f"""CONCAT(
  {SYSTEM!r}, '\\n\\nMARKET: ', question, ' (course: ', course, ', type: ', market_type,
  ', closes: ', CAST(closes_at AS STRING), ', resolution source: ', COALESCE(resolution_source, 'n/a'), ')',
  '\\nPRICES (crowd vs smart money per outcome): ', COALESCE(prices_json, '[]'),
  '\\nFIRST OUTCOME PRICE: opened at ', COALESCE(CAST(first_price_outcome0 AS STRING), 'n/a'),
  ', now ', COALESCE(CAST(last_price_outcome0 AS STRING), 'n/a'),
  '\\nACTIVITY LAST 24H: ', trades_24h, ' trades, ', clout_24h, ' Clout',
  '\\nRECENT COMMENTS: ', comments_json,
  '\\n\\nWrite each field in 1-2 sentences. Only call it mispriced if crowd and smart money differ by 15+ percentage points; otherwise say they roughly agree.'
)"""

insights = spark.sql(f"""
SELECT market_id, course, question, prompt,
       ai_query('{model}', prompt, responseFormat => '{RESPONSE_FORMAT.replace(chr(10), ' ')}') AS raw
FROM (SELECT *, {prompt_sql} AS prompt FROM analyst_context)
""").cache()

schema = "summary STRING, why_price_moved STRING, crowd_vs_smart_money STRING, comment_sentiment STRING, mispricing_flag BOOLEAN, confidence STRING"
from pyspark.sql import functions as F

# The mispricing flag is a rule, not an opinion: compute it from gold (gap >= 15 points), never from the LLM.
gaps = spark.table(f"{catalog}.gold.market_mispricing").select("market_id", "gap")
out = (insights
       .withColumn("insight", F.from_json("raw", schema))
       .join(gaps, "market_id", "left")
       .withColumn("insight", F.col("insight").withField("mispricing_flag", F.coalesce(F.col("gap") >= 0.15, F.lit(False))))
       .select("market_id", "course", "question", "insight.*", F.round("gap", 3).alias("crowd_smart_gap"),
               F.lit(model).alias("model"), F.current_timestamp().alias("generated_at"),
               F.lit(True).alias("based_on_simulated_data")))
# Merge, don't overwrite: markets skipped this run keep their last insight.
if spark.catalog.tableExists(insights_table):
    out.createOrReplaceTempView("new_insights")
    spark.sql(f"""MERGE INTO {insights_table} t USING new_insights s ON t.market_id = s.market_id
                  WHEN MATCHED THEN UPDATE SET * WHEN NOT MATCHED THEN INSERT *""")
else:
    out.write.saveAsTable(insights_table)
print(f"insights generated this run: {insights.count()} (max {MAX_MARKETS})")

# COMMAND ----------

# MLflow tracing: one trace per market, so prompts/answers are inspectable in the Experiments UI.
import mlflow

user = spark.sql("SELECT current_user()").first()[0]
mlflow.set_experiment(f"/Users/{user}/the-curve-ai-analyst")
for r in insights.select("market_id", "question", "prompt", "raw").collect():
    with mlflow.start_span(name="market_analyst_batch", span_type="LLM") as span:
        span.set_inputs({"market_id": r.market_id, "question": r.question, "prompt": r.prompt, "model": model})
        span.set_outputs({"insight": r.raw})
        span.set_attributes({"source": "ai_query", "catalog": catalog})
print(f"Logged {insights.count()} traces to /Users/{user}/the-curve-ai-analyst")
