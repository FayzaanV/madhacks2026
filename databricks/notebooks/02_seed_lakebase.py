# Databricks notebook source
# MAGIC %md
# MAGIC # 02 · Seed the Lakebase ledger from `bronze`
# MAGIC Creates the Postgres schema (`db/schema.sql`) in the Lakebase project and loads the simulated
# MAGIC rows so the app starts with a populated campus. **Truncates the ledger first.**

# COMMAND ----------

# MAGIC %pip install -q "psycopg[binary]>=3.2" "databricks-sdk>=0.70"
# MAGIC %restart_python

# COMMAND ----------

dbutils.widgets.text("catalog", "the_curve")
dbutils.widgets.text("endpoint", "projects/the-curve-ledger/branches/production/endpoints/primary")
dbutils.widgets.text("database", "databricks_postgres")
catalog = dbutils.widgets.get("catalog")
endpoint_name = dbutils.widgets.get("endpoint")
database = dbutils.widgets.get("database")

import os

import psycopg
from databricks.sdk import WorkspaceClient

w = WorkspaceClient()
ep = w.postgres.get_endpoint(name=endpoint_name)
cred = w.postgres.generate_database_credential(endpoint=endpoint_name)
me = w.current_user.me().user_name
conn = psycopg.connect(host=ep.status.hosts.host, dbname=database, user=me, password=cred.token,
                       sslmode="require", autocommit=False)
print("connected to", ep.status.hosts.host, "as", me)

# COMMAND ----------

_nb = dbutils.notebook.entry_point.getDbutils().notebook().getContext().notebookPath().get()
NB_DIR = os.path.dirname(_nb if _nb.startswith("/Workspace") else "/Workspace" + _nb)
schema_sql = open(os.path.join(os.path.dirname(os.path.dirname(NB_DIR)), "db", "schema.sql")).read()
with conn.cursor() as cur:
    cur.execute(schema_sql)
    cur.execute("TRUNCATE schools, sessions, login_tokens, ai_questions, disputes, comments, resolutions, trades, outcomes, markets, users CASCADE")
conn.commit()

# COMMAND ----------

TABLES = [  # (bronze table, postgres table) in FK order
    ("schools_raw", "schools"), ("users_raw", "users"), ("markets_raw", "markets"), ("outcomes_raw", "outcomes"), ("trades_raw", "trades"),
    ("resolutions_raw", "resolutions"), ("comments_raw", "comments"), ("disputes_raw", "disputes"),
]
DROP = {"source", "ingested_at"}

with conn.cursor() as cur:
    for bronze, pg in TABLES:
        df = spark.table(f"{catalog}.bronze.{bronze}")
        cols = [c for c in df.columns if c not in DROP]
        rows = [tuple(r[c] for c in cols) for r in df.select(*cols).collect()]
        with cur.copy(f"COPY {pg} ({', '.join(cols)}) FROM STDIN") as copy:
            for r in rows:
                copy.write_row(r)
        print(f"{pg}: {len(rows)} rows")
conn.commit()

with conn.cursor() as cur:
    cur.execute("SELECT (SELECT count(*) FROM users), (SELECT count(*) FROM trades), (SELECT count(*) FROM markets)")
    print("users, trades, markets =", cur.fetchone())
conn.close()
