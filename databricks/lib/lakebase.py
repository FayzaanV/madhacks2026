"""Lakebase (Postgres) connection and bulk helpers for notebooks. Needs psycopg + databricks-sdk (notebook %pip)."""
from __future__ import annotations


def connect(endpoint: str, database: str = "databricks_postgres"):
    """Connect as whoever runs the job, with a short-lived Lakebase credential (no passwords)."""
    import psycopg
    from databricks.sdk import WorkspaceClient

    w = WorkspaceClient()
    ep = w.postgres.get_endpoint(name=endpoint)
    cred = w.postgres.generate_database_credential(endpoint=endpoint)
    me = w.current_user.me().user_name
    return psycopg.connect(host=ep.status.hosts.host, dbname=database, user=me, password=cred.token,
                           sslmode="require", autocommit=False)


def insert_metrics(conn, rows: list[dict]) -> int:
    """Bulk-insert venue_metrics rows (COPY into a temp table, then INSERT ... ON CONFLICT DO NOTHING)."""
    if not rows:
        return 0
    cols = ["venue_id", "metric", "value", "observed_at", "source", "is_simulated"]
    with conn.transaction(), conn.cursor() as cur:
        cur.execute("CREATE TEMP TABLE IF NOT EXISTS _vm (LIKE venue_metrics INCLUDING DEFAULTS) ON COMMIT DROP")
        with cur.copy(f"COPY _vm ({', '.join(cols)}) FROM STDIN") as copy:
            for r in rows:
                copy.write_row(tuple(r[c] for c in cols))
        cur.execute(f"INSERT INTO venue_metrics ({', '.join(cols)}) SELECT {', '.join(cols)} FROM _vm ON CONFLICT DO NOTHING")
        return cur.rowcount
