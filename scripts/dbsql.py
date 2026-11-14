#!/usr/bin/env python3
"""Run SQL on the team's Databricks SQL warehouse via the Databricks CLI.

Usage:
  python3 scripts/dbsql.py "SELECT 1"
  python3 scripts/dbsql.py -f path/to/file.sql     # statements split on ';' at line end

Uses the CLI's DEFAULT profile (run `databricks auth login` first).
Warehouse id comes from $DATABRICKS_WAREHOUSE_ID or the first warehouse found.
"""
import json
import os
import subprocess
import sys
import time


def cli(*args, body=None):
    cmd = ["databricks", *args, "-o", "json"]
    if body is not None:
        cmd += ["--json", json.dumps(body)]
    out = subprocess.run(cmd, capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit(out.stderr.strip() or out.stdout.strip())
    return json.loads(out.stdout) if out.stdout.strip() else {}


def warehouse_id():
    wid = os.environ.get("DATABRICKS_WAREHOUSE_ID")
    if wid:
        return wid
    whs = cli("warehouses", "list")
    if not whs:
        raise SystemExit("No SQL warehouse found")
    return whs[0]["id"]


def run(statement, wid):
    res = cli("api", "post", "/api/2.0/sql/statements",
              body={"statement": statement, "warehouse_id": wid, "wait_timeout": "50s",
                    "on_wait_timeout": "CONTINUE"})
    sid = res["statement_id"]
    while res["status"]["state"] in ("PENDING", "RUNNING"):
        time.sleep(2)
        res = cli("api", "get", f"/api/2.0/sql/statements/{sid}")
    state = res["status"]["state"]
    if state != "SUCCEEDED":
        err = res["status"].get("error", {}).get("message", state)
        raise RuntimeError(err)
    cols = [c["name"] for c in res.get("manifest", {}).get("schema", {}).get("columns", [])]
    rows = res.get("result", {}).get("data_array", []) or []
    return cols, rows


def split_sql(text):
    stmts, cur = [], []
    for line in text.splitlines():
        if line.strip().startswith("--") and not cur:
            continue
        cur.append(line)
        if line.rstrip().endswith(";"):
            stmts.append("\n".join(cur).rstrip().rstrip(";"))
            cur = []
    if "".join(cur).strip():
        stmts.append("\n".join(cur))
    return [s for s in stmts if s.strip()]


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 1
    if args[0] == "-f":
        stmts = split_sql(open(args[1]).read())
    else:
        stmts = [" ".join(args)]
    wid = warehouse_id()
    failed = 0
    for s in stmts:
        head = " ".join(s.split())[:90]
        try:
            cols, rows = run(s, wid)
            print(f"OK  {head}")
            if cols and rows:
                print("    " + " | ".join(cols))
                for r in rows[:50]:
                    print("    " + " | ".join("" if v is None else str(v) for v in r))
        except RuntimeError as e:
            failed += 1
            print(f"ERR {head}\n    {e}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
