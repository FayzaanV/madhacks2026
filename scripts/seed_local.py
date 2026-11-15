"""Load the simulated campus into a LOCAL Postgres for offline development (no Databricks compute needed).

Same data as databricks/notebooks/01_simulate_data.py + 02_seed_lakebase.py, written straight to Postgres:
    python scripts/seed_local.py postgresql://postgres@localhost:5433/yomi
Applies db/schema.sql, truncates the ledger, loads ~2,000 simulated users, 50 markets and ~19k trades, then
re-applies the schema (restores system users). Never point this at the shared Lakebase ledger.
"""
import os
import sys

import psycopg

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "databricks", "lib"))
import simulate  # noqa: E402

url = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("DATABASE_URL", "postgresql://postgres@localhost:5433/yomi")
if "localhost" not in url and "127.0.0.1" not in url:
    sys.exit(f"Refusing to seed a non-local database: {url}")

schema = open(os.path.join(ROOT, "db", "schema.sql")).read()
rows = simulate.simulate(seed=42)
ORDER = [("schools_raw", "schools"), ("users_raw", "users"), ("markets_raw", "markets"), ("outcomes_raw", "outcomes"),
         ("trades_raw", "trades"), ("resolutions_raw", "resolutions"), ("comments_raw", "comments")]

with psycopg.connect(url) as conn:
    with conn.cursor() as cur:
        cur.execute(schema)
        cur.execute("TRUNCATE schools, sessions, login_tokens, ai_questions, disputes, comments, resolutions, trades, "
                    "outcomes, markets, users CASCADE")
        for raw, table in ORDER:
            data = rows.get(raw) or []
            if not data:
                continue
            cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = %s", (table,))
            have = {r[0] for r in cur.fetchall()}
            cols = [c for c in data[0] if c in have]
            with cur.copy(f"COPY {table} ({', '.join(cols)}) FROM STDIN") as copy:
                for r in data:
                    copy.write_row(tuple(r[c] for c in cols))
            print(f"{table}: {len(data)} rows")
        cur.execute(schema)  # restore system users removed by the TRUNCATE ... CASCADE
        cur.execute("SELECT (SELECT count(*) FROM users), (SELECT count(*) FROM trades), (SELECT count(*) FROM markets)")
        print("users, trades, markets =", cur.fetchone())
