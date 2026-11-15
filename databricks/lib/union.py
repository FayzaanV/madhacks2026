"""Union markets: daily templates, settlement rules, and payouts. Pure Python (stdlib + clout.py).

A Union market is a normal binary market (outcome 0 = Yes, 1 = No, course = 'Union') plus a row in
`market_rules`: venue, metric, comparison, threshold, a time window and how to aggregate readings in it.
The union_settle job evaluates the rule after the window and pays out with the same semantics as
resolveMarket in app/src/server/markets.ts (keep the two in step).
"""
from __future__ import annotations

import statistics
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

import clout as c
from venues import LOCAL, VENUES

SOURCE_PRIORITY = ["partner", "occuspace", "sim"]  # best data first
MIN_REPORTS = 3  # student check-ins needed when no sensor/partner data covers the window
CLOSE_BEFORE = timedelta(minutes=15)  # trading stops before the window opens
ROUND = {"occupancy_pct": 5, "people": 25, "wait_min": 1, "line_len": 1, "sales": 10}
UNITS = {"occupancy_pct": "% full", "people": " people", "wait_min": " min", "line_len": " in line", "sales": " items"}


@dataclass(frozen=True)
class Template:
    key: str
    venue_id: str
    metric: str
    at: time  # local start of the window
    window_min: int
    agg: str  # 'avg' | 'max' | 'last'
    question: str  # {t} = threshold


TEMPLATES = [
    Template("sett-busy-7pm", "sett", "occupancy_pct", time(19, 0), 15, "avg",
             "Will the Sett be at least {t}% full at 7pm tonight?"),
    Template("terrace-crowd-5pm", "terrace", "people", time(17, 0), 15, "avg",
             "Will the Terrace have {t}+ people at 5pm today?"),
    Template("rath-busy-1230", "rathskeller", "occupancy_pct", time(12, 30), 15, "avg",
             "Will the Rathskeller be at least {t}% full at 12:30 today?"),
    Template("strada-wait-noon", "strada", "wait_min", time(12, 0), 30, "max",
             "Will the Strada wait hit {t}+ minutes during the noon rush?"),
    Template("strada-sales-2pm", "strada", "sales", time(14, 0), 5, "last",
             "Will Strada sell {t}+ items by 2pm today?"),
]


def round_threshold(metric: str, value: float) -> float:
    step = ROUND.get(metric, 1)
    return max(step, round(value / step) * step)


def market_for(t: Template, day: date, baseline: float | None) -> dict | None:
    """Market + rule for one template on one local day. Threshold = the baseline median, so it opens near 50/50."""
    if baseline is None:
        return None
    start = datetime.combine(day, t.at, tzinfo=LOCAL).astimezone(timezone.utc)
    threshold = round_threshold(t.metric, baseline)
    shown = int(threshold) if threshold == int(threshold) else threshold
    return {
        "market_id": f"m-union-{t.key}-{day.isoformat()}",
        "question": t.question.format(t=shown),
        "closes_at": start - CLOSE_BEFORE,
        "rule": {"venue_id": t.venue_id, "metric": t.metric, "op": ">=", "threshold": float(threshold),
                 "window_start": start, "window_end": start + timedelta(minutes=t.window_min), "agg": t.agg},
        "resolution_source": f"{VENUES[t.venue_id]['name']} {t.metric} ({'sensor' if VENUES[t.venue_id]['sensor'] != 'none' else 'Union point of sale'})",
    }


def baseline(t: Template, rows: list[tuple[datetime, float]], day: date, days: int = 28) -> float | None:
    """Median of the template's window aggregate on past days (same weekday if 2+ exist), from (observed_at, value)."""
    per_day: dict[date, list[float]] = {}
    for ts, val in rows:
        lt = ts.astimezone(LOCAL)
        start = datetime.combine(lt.date(), t.at, tzinfo=LOCAL)
        if lt.date() < day and (day - lt.date()).days <= days and start <= lt < start + timedelta(minutes=t.window_min):
            per_day.setdefault(lt.date(), []).append(float(val))
    aggs = {d: aggregate(v, t.agg) for d, v in per_day.items()}
    same = [x for d, x in aggs.items() if d.weekday() == day.weekday()]
    pool = same if len(same) >= 2 else list(aggs.values())
    return statistics.median(pool) if pool else None


def aggregate(values: list[float], agg: str) -> float:
    if agg == "max":
        return max(values)
    if agg == "last":
        return values[-1]
    return sum(values) / len(values)


def evaluate(rule: dict, metrics: list[dict], reports: list[dict] | None = None):
    """Decide a Union market from data in its window.

    metrics: rows {source, value, observed_at} for the rule's venue and metric inside the window.
    reports: student check-ins {value} for the same metric and window (fallback only).
    Returns (winner, rationale) with winner 0 = Yes, 1 = No, or "void" when there's not enough data.
    """
    label = VENUES.get(rule["venue_id"], {}).get("name", rule["venue_id"])
    unit = UNITS.get(rule["metric"], "")
    for src in SOURCE_PRIORITY:
        rows = sorted((m for m in metrics if m["source"] == src), key=lambda m: m["observed_at"])
        if rows:
            value = aggregate([float(m["value"]) for m in rows], rule["agg"])
            how = f"{rule['agg']} of {len(rows)} {src} readings"
            break
    else:
        vals = [float(r["value"]) for r in (reports or [])]
        if len(vals) < MIN_REPORTS:
            return "void", f"No sensor, partner or enough student data for {label} {rule['metric']} in the window; voided."
        value, how = statistics.median(vals), f"median of {len(vals)} student reports"
    met = value >= rule["threshold"] if rule["op"] == ">=" else value < rule["threshold"]
    v = round(value, 1)
    return (0 if met else 1), (
        f"{label} {rule['metric']}: {v}{unit} ({how}) {'meets' if met else 'misses'} "
        f"{rule['op']} {rule['threshold']:g}{unit} → {'Yes' if met else 'No'}"
    )


def credits(trades: list[tuple[str, int, float, float]], winner) -> dict[str, float]:
    """Balance credit per user when a market settles. trades: (user_id, outcome_index, clout_spent, shares), signed.

    Same as resolveMarket: payout = net winning shares held (net_clout_change + net spent); void = net Clout put in.
    """
    by_user: dict[str, list[tuple[int, float, float]]] = {}
    for user, outcome, spent, shares in trades:
        by_user.setdefault(user, []).append((outcome, spent, shares))
    out = {}
    for user, ts in by_user.items():
        spent = sum(s for _, s, _ in ts)
        credit = spent if winner == "void" else c.net_clout_change(ts, winner) + spent
        if abs(credit) > 1e-9:
            out[user] = credit
    return out


def settle(conn, market_id: str, winner, rationale: str, resolver_id: str) -> dict | None:
    """Resolve one market in Lakebase in a single transaction (psycopg connection). None if already settled.

    Lock order matches the app: the market row FOR UPDATE first, so trades (which take it FOR SHARE) wait.
    """
    with conn.transaction(), conn.cursor() as cur:
        cur.execute("SELECT status FROM markets WHERE market_id = %s FOR UPDATE", (market_id,))
        row = cur.fetchone()
        if not row or row[0] not in ("live", "closed"):
            return None
        cur.execute("SELECT user_id, outcome_index, clout_spent, shares FROM trades WHERE market_id = %s", (market_id,))
        pay = credits(cur.fetchall(), winner)
        if pay:
            cur.execute(
                "UPDATE users u SET clout = u.clout + x.credit FROM unnest(%s::text[], %s::float8[]) AS x(user_id, credit) "
                "WHERE u.user_id = x.user_id", (list(pay), list(pay.values())))
        status = "voided" if winner == "void" else "resolved"
        cur.execute("UPDATE markets SET status = %s WHERE market_id = %s", (status, market_id))
        cur.execute(
            """INSERT INTO resolutions (market_id, winning_outcome_index, resolved_by, rationale, resolved_at, dispute_deadline, status)
               VALUES (%s, %s, %s, %s, now(), now() + interval '24 hours', %s)
               ON CONFLICT (market_id) DO UPDATE SET winning_outcome_index = EXCLUDED.winning_outcome_index,
                 resolved_by = EXCLUDED.resolved_by, rationale = EXCLUDED.rationale, resolved_at = now(),
                 dispute_deadline = EXCLUDED.dispute_deadline, final_at = NULL, status = EXCLUDED.status""",
            (market_id, None if winner == "void" else winner, resolver_id, rationale, status))
    return {"market_id": market_id, "status": status, "traders": len(pay), "paid_out": sum(pay.values())}
