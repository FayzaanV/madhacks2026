#!/usr/bin/env bash
# Turn Yomi's Databricks pieces on/off to save Free Edition compute. Build locally (local mode) in between.
#   scripts/cloud.sh down      stop the website, the SQL warehouse, and the Lakebase database
#   scripts/cloud.sh up        start the database and the website (the warehouse wakes on the first query)
#   scripts/cloud.sh refresh [--ai]   rebuild Brier/calibration/charts once (+ AI insights with --ai), restart the app
#   (leaderboards are always live from the database and need no refresh)
#   scripts/cloud.sh status    what's running
# Uses your default Databricks CLI profile (the team workspace). Windows: scripts/cloud.ps1.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
APP=yomi
WAREHOUSE=cba268733f96d335
ENDPOINT=projects/the-curve-ledger/branches/production/endpoints/primary
db() { (cd "$HOME" && databricks "$@"); }   # outside the repo, so databricks.yml doesn't pick the host

set_db() {  # $1 = true (disable) | false (enable)
  if ! out=$(db postgres update-endpoint "$ENDPOINT" spec.disabled --json "{\"spec\":{\"disabled\":$1}}" -o json 2>&1); then
    echo "  database: couldn't change it ($(echo "$out" | head -1)); it stays as is"
  else
    echo "  database: $([ "$1" = true ] && echo disabled || echo enabled)"
  fi
}

status() {
  db apps get "$APP" -o json | python3 -c "import json,sys;a=json.load(sys.stdin);print('  website:  ', a.get('compute_status',{}).get('state'), '|', a.get('url'))"
  db warehouses get "$WAREHOUSE" -o json | python3 -c "import json,sys;w=json.load(sys.stdin);print('  warehouse:', w['state'])"
  db postgres get-endpoint "$ENDPOINT" -o json | python3 -c "import json,sys;e=json.load(sys.stdin)['status'];print('  database: ', e.get('current_state'), '(disabled)' if e.get('disabled') else '')"
  db jobs list -o json | python3 -c "import json,sys;[print('  job:      ', j['settings']['name'], j['settings'].get('schedule',{}).get('pause_status','manual')) for j in json.load(sys.stdin)]"
}

case "${1:-status}" in
  down)
    echo "Stopping Yomi on Databricks..."
    db apps stop "$APP" >/dev/null && echo "  website: stopped"
    db warehouses stop "$WAREHOUSE" >/dev/null && echo "  warehouse: stopped"
    set_db true
    ;;
  up)
    echo "Starting Yomi on Databricks (takes a few minutes)..."
    set_db false
    db apps start "$APP" >/dev/null && echo "  website: started"
    status
    ;;
  refresh)
    echo "Rebuilding Brier, calibration, Smart Money and charts (one run)..."
    (cd "$REPO" && databricks bundle run refresh)
    if [ "${2:-}" = "--ai" ]; then
      echo "Generating AI insights for the busiest markets..."
      (cd "$REPO" && databricks bundle run ai_insights)
    fi
    echo "Restarting the website so it shows the new numbers..."
    (cd "$REPO" && databricks bundle run "$APP" >/dev/null) && echo "  done"
    ;;
  status) status ;;
  *) echo "usage: $0 up | down | refresh | status" >&2; exit 2 ;;
esac
