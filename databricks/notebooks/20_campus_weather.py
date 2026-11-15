# Databricks notebook source
# MAGIC %md
# MAGIC # 20 · Weather for campus markets → Lakebase `weather_observations`
# MAGIC Weather markets ("Will Madison's high on Mon be at least 40°F?") settle from Open-Meteo's daily values. Databricks
# MAGIC serverless can reach Open-Meteo (the app on Free Edition can't reach outside sites), so this task fetches the
# MAGIC value for every open weather market whose day has ended in Madison and saves it to Lakebase. The app's campus
# MAGIC poller then settles the market from that row (`app/src/server/campus-data.ts`). Runs inside `yomi-refresh`.

# COMMAND ----------

# MAGIC %pip install -q "psycopg[binary]>=3.2" "databricks-sdk>=0.70"
# MAGIC %restart_python

# COMMAND ----------

dbutils.widgets.text("endpoint", "projects/the-curve-ledger/branches/production/endpoints/primary")
endpoint = dbutils.widgets.get("endpoint")

import json
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

_nb = dbutils.notebook.entry_point.getDbutils().notebook().getContext().notebookPath().get()
NB_DIR = os.path.dirname(_nb if _nb.startswith("/Workspace") else "/Workspace" + _nb)
sys.path.insert(0, os.path.join(os.path.dirname(NB_DIR), "lib"))
import lakebase  # noqa: E402

# Same names and units as app/src/core/auto-rules.ts WEATHER_METRICS.
METRICS = {"temp_max_f": "temperature_2m_max", "temp_min_f": "temperature_2m_min",
           "precip_in": "precipitation_sum", "snow_in": "snowfall_sum"}
MADISON = {"latitude": 43.075, "longitude": -89.404}
today = datetime.now(ZoneInfo("America/Chicago")).date().isoformat()

conn = lakebase.connect(endpoint)
with conn.cursor() as cur:
    cur.execute("SELECT auto_rule FROM markets WHERE auto_rule IS NOT NULL AND status IN ('live', 'closed')")
    rules = [json.loads(r[0]) for r in cur.fetchall()]
days = sorted({r["date"] for r in rules if r.get("kind") == "weather" and r["date"] < today})
print("weather days to fetch:", days or "none")

# COMMAND ----------

saved = 0
for day in days:
    res = requests.get("https://api.open-meteo.com/v1/forecast", timeout=20, params={
        **MADISON, "daily": ",".join(METRICS.values()), "start_date": day, "end_date": day,
        "timezone": "America/Chicago", "temperature_unit": "fahrenheit", "precipitation_unit": "inch"})
    res.raise_for_status()
    daily = res.json()["daily"]
    with conn.transaction(), conn.cursor() as cur:
        for metric, field in METRICS.items():
            value = daily.get(field, [None])[0]
            if value is None:
                continue
            cur.execute(
                """INSERT INTO weather_observations (obs_date, metric, value) VALUES (%s, %s, %s)
                   ON CONFLICT (obs_date, metric) DO UPDATE SET value = EXCLUDED.value, fetched_at = now()""",
                (day, metric, float(value)))
            saved += 1
    print(day, {m: daily.get(f, [None])[0] for m, f in METRICS.items()})
conn.close()
print(f"saved {saved} weather values")
