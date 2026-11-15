# Databricks notebook source
# MAGIC %md
# MAGIC # 40 · Union venue feed → Lakebase `venue_metrics`
# MAGIC For each venue: real Occuspace sensor readings when the secret `the-curve/occuspace_token` exists and the venue
# MAGIC has an Occuspace `external_id`; otherwise the simulated feed (`databricks/lib/venues.py`, `source='sim'`,
# MAGIC `is_simulated=true`). Simulated readings are filled in from the last one written (or 30 days back on first run),
# MAGIC so gaps between job runs are filled and baselines exist from day one. Point-of-sale data (sales, waits) arrives
# MAGIC separately through the app's partner API (`source='partner'`). Runs as the first task of `yomi-refresh`.

# COMMAND ----------

# MAGIC %pip install -q "psycopg[binary]>=3.2" "databricks-sdk>=0.70"
# MAGIC %restart_python

# COMMAND ----------

dbutils.widgets.text("endpoint", "projects/the-curve-ledger/branches/production/endpoints/primary")
dbutils.widgets.text("backfill_days", "30")
endpoint = dbutils.widgets.get("endpoint")
backfill_days = int(dbutils.widgets.get("backfill_days"))

import os
import sys
from datetime import datetime, timedelta, timezone

_nb = dbutils.notebook.entry_point.getDbutils().notebook().getContext().notebookPath().get()
NB_DIR = os.path.dirname(_nb if _nb.startswith("/Workspace") else "/Workspace" + _nb)
sys.path.insert(0, os.path.join(os.path.dirname(NB_DIR), "lib"))
import lakebase  # noqa: E402
import occuspace  # noqa: E402
import venues  # noqa: E402

conn = lakebase.connect(endpoint)
try:
    token = dbutils.secrets.get("the-curve", "occuspace_token")
except Exception:
    token = None
print("Occuspace token:", "yes" if token else "no (simulated feed only)")

# COMMAND ----------

now = venues.floor_step(datetime.now(timezone.utc))
with conn.cursor() as cur:
    cur.execute("SELECT venue_id, capacity, sensor, external_id FROM venues")
    rows = cur.fetchall()
    cur.execute("SELECT venue_id, max(observed_at) FROM venue_metrics WHERE source = 'sim' GROUP BY venue_id")
    last_sim = dict(cur.fetchall())
conn.commit()

written = {}
for venue_id, capacity, sensor, external_id in rows:
    if token and sensor == "occuspace" and external_id:
        try:
            written[venue_id] = lakebase.insert_metrics(conn, occuspace.fetch(token, external_id, capacity, venue_id))
            continue  # real data: no simulated rows for this venue
        except Exception as e:  # noqa: BLE001
            print(f"{venue_id}: Occuspace fetch failed ({e}); falling back to simulated feed")
    if venue_id not in venues.VENUES:
        print(f"{venue_id}: no simulator profile and no live source; skipped")
        continue
    start = max(last_sim.get(venue_id) or now - timedelta(days=backfill_days), now - timedelta(days=backfill_days))
    sim = venues.backfill(now, days=(now - start) / timedelta(days=1), venue_ids=[venue_id]) if start < now else []
    written[venue_id] = lakebase.insert_metrics(conn, [r for r in sim if r["observed_at"] > start] if venue_id in last_sim else sim)
print("rows written per venue:", written)
conn.close()
