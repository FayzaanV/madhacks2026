# Databricks notebook source
# MAGIC %md
# MAGIC # 41 · Open today's Union markets
# MAGIC One market per template in `databricks/lib/union.py` (e.g. "Will the Sett be at least 80% full at 7pm tonight?").
# MAGIC The threshold is the median of the same window on past days (same weekday when possible), so each market opens
# MAGIC near 50/50. Trading closes 15 minutes before the window; `union_settle` resolves it from data afterwards.
# MAGIC Idempotent: market ids are `m-union-<template>-<date>`. Runs daily (job `yomi-union-markets`).

# COMMAND ----------

# MAGIC %pip install -q "psycopg[binary]>=3.2" "databricks-sdk>=0.70"
# MAGIC %restart_python

# COMMAND ----------

dbutils.widgets.text("endpoint", "projects/the-curve-ledger/branches/production/endpoints/primary")
dbutils.widgets.text("liquidity_b", "300")
endpoint = dbutils.widgets.get("endpoint")
liquidity_b = float(dbutils.widgets.get("liquidity_b"))

import os
import sys
from datetime import datetime, timezone

_nb = dbutils.notebook.entry_point.getDbutils().notebook().getContext().notebookPath().get()
NB_DIR = os.path.dirname(_nb if _nb.startswith("/Workspace") else "/Workspace" + _nb)
sys.path.insert(0, os.path.join(os.path.dirname(NB_DIR), "lib"))
import lakebase  # noqa: E402
import union  # noqa: E402
from venues import LOCAL  # noqa: E402

conn = lakebase.connect(endpoint)
now = datetime.now(timezone.utc)
today = now.astimezone(LOCAL).date()

# COMMAND ----------

created = []
for t in union.TEMPLATES:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT observed_at, value, source FROM venue_metrics WHERE venue_id = %s AND metric = %s "
            "AND observed_at > now() - interval '29 days' ORDER BY observed_at",
            (t.venue_id, t.metric),
        )
        hist = cur.fetchall()
    conn.commit()
    m = union.market_for(t, today, union.baseline(t, [(ts, v) for ts, v, _ in hist], today))
    if m is None or m["closes_at"] <= now:
        print(f"{t.key}: skipped ({'no history' if m is None else 'already closed today'})")
        continue
    # Label the market simulated unless real data (sensor or partner) arrived for it in the last day.
    simulated = not any(src != "sim" and (now - ts).days < 1 for ts, _, src in hist)
    r = m["rule"]
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            """INSERT INTO markets (market_id, school_id, course, question, market_type, status, liquidity_b, creator_id,
                                    resolution_source, is_simulated, opens_at, closes_at)
               VALUES (%s, 'uw-madison', 'Union', %s, 'binary', 'live', %s, 'u-yomi-union', %s, %s, now(), %s)
               ON CONFLICT (market_id) DO NOTHING""",
            (m["market_id"], m["question"], liquidity_b, m["resolution_source"], simulated, m["closes_at"]),
        )
        if cur.rowcount == 0:
            print(f"{t.key}: already open")
            continue
        cur.executemany(
            "INSERT INTO outcomes (market_id, outcome_index, label, q_shares, is_simulated) VALUES (%s, %s, %s, 0, %s)",
            [(m["market_id"], 0, "Yes", simulated), (m["market_id"], 1, "No", simulated)],
        )
        cur.execute(
            """INSERT INTO market_rules (market_id, venue_id, metric, op, threshold, window_start, window_end, agg)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (m["market_id"], r["venue_id"], r["metric"], r["op"], r["threshold"], r["window_start"], r["window_end"], r["agg"]),
        )
    created.append(m["question"])
print(f"opened {len(created)} markets:", *created, sep="\n  ")
conn.close()
