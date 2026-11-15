# Databricks notebook source
# MAGIC %md
# MAGIC # 42 · Settle Union markets from data
# MAGIC Every live Union market whose window has ended is decided by `union.evaluate`: partner data first, then the
# MAGIC Occuspace sensor, then the simulated feed; with none of those, the median of 3+ student check-ins; otherwise
# MAGIC void. `union.settle` pays out in one Lakebase transaction with the same semantics as the app's resolveMarket.
# MAGIC Runs inside `yomi-refresh` after the feed and before the bronze sync, so gold sees the result the same run.

# COMMAND ----------

# MAGIC %pip install -q "psycopg[binary]>=3.2" "databricks-sdk>=0.70"
# MAGIC %restart_python

# COMMAND ----------

dbutils.widgets.text("endpoint", "projects/the-curve-ledger/branches/production/endpoints/primary")
endpoint = dbutils.widgets.get("endpoint")

import os
import sys

_nb = dbutils.notebook.entry_point.getDbutils().notebook().getContext().notebookPath().get()
NB_DIR = os.path.dirname(_nb if _nb.startswith("/Workspace") else "/Workspace" + _nb)
sys.path.insert(0, os.path.join(os.path.dirname(NB_DIR), "lib"))
import lakebase  # noqa: E402
import union  # noqa: E402

conn = lakebase.connect(endpoint)

# COMMAND ----------

with conn.cursor() as cur:
    # 2 minutes of grace so the last reading of the window has landed.
    cur.execute(
        """SELECT r.market_id, r.venue_id, r.metric, r.op, r.threshold, r.window_start, r.window_end, r.agg
           FROM market_rules r JOIN markets m USING (market_id)
           WHERE m.status = 'live' AND r.window_end <= now() - interval '2 minutes'"""
    )
    cols = [d.name for d in cur.description]
    due = [dict(zip(cols, row)) for row in cur.fetchall()]
conn.commit()
print(f"{len(due)} Union markets due")

results = []
for rule in due:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT source, value, observed_at FROM venue_metrics WHERE venue_id = %s AND metric = %s "
            "AND observed_at >= %s AND observed_at < %s",
            (rule["venue_id"], rule["metric"], rule["window_start"], rule["window_end"]),
        )
        metrics = [{"source": s, "value": v, "observed_at": t} for s, v, t in cur.fetchall()]
        # Check-ins count from 15 minutes before the window (people report the line they're standing in).
        cur.execute(
            "SELECT value FROM venue_reports WHERE venue_id = %s AND metric = %s "
            "AND created_at >= %s - interval '15 minutes' AND created_at < %s",
            (rule["venue_id"], rule["metric"], rule["window_start"], rule["window_end"]),
        )
        reports = [{"value": v} for (v,) in cur.fetchall()]
    conn.commit()
    winner, why = union.evaluate(rule, metrics, reports)
    out = union.settle(conn, rule["market_id"], winner, why, "u-yomi-union")
    results.append(out)
    print(rule["market_id"], "→", winner, "|", why, "|", out)
conn.close()
