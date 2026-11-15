"""Wisconsin Union venues and a simulated sensor / point-of-sale feed. Pure Python, deterministic.

The simulated feed stands in for the real sources until a partner plugs in:
  - occupancy (people, occupancy_pct): Occuspace/Waitz Wi-Fi sensors already run in the Terrace, Rathskeller, Sett
  - wait_min, line_len, sales: the Union's point-of-sale system via the partner API
Every simulated row has source='sim' and is_simulated=True. Times are UTC; daily shapes follow Madison local time.
"""
from __future__ import annotations

import hashlib
import math
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

LOCAL = ZoneInfo("America/Chicago")
STEP = timedelta(minutes=5)

# venue_id -> definition. Seeded into Lakebase `venues`; edit there for real deployments.
VENUES = {
    "terrace": {"name": "Memorial Union Terrace", "building": "Memorial Union", "capacity": 1200, "sensor": "occuspace",
                "metrics": ["people", "occupancy_pct"]},
    "rathskeller": {"name": "Rathskeller", "building": "Memorial Union", "capacity": 400, "sensor": "occuspace",
                    "metrics": ["people", "occupancy_pct"]},
    "sett": {"name": "The Sett", "building": "Union South", "capacity": 600, "sensor": "occuspace",
             "metrics": ["people", "occupancy_pct"]},
    "strada": {"name": "Strada", "building": "Wisconsin Union", "capacity": 80, "sensor": "none",
               "metrics": ["wait_min", "line_len", "sales"]},
}
METRICS = {"people", "occupancy_pct", "wait_min", "line_len", "sales"}

# Hourly busyness 0..1 by local hour (index 0-23), weekday and weekend.
_PROFILES = {
    "terrace": ([0, 0, 0, 0, 0, 0, 0, .05, .08, .1, .15, .3, .45, .45, .4, .45, .55, .65, .7, .65, .5, .3, .15, .05],
                [0, 0, 0, 0, 0, 0, 0, .03, .05, .1, .2, .4, .6, .7, .75, .8, .8, .85, .85, .75, .6, .4, .2, .05]),
    "rathskeller": ([0, 0, 0, 0, 0, 0, 0, .1, .2, .25, .35, .6, .85, .7, .45, .4, .45, .55, .6, .55, .45, .35, .2, .05],
                    [0, 0, 0, 0, 0, 0, 0, .05, .1, .15, .25, .45, .6, .6, .5, .45, .5, .6, .65, .6, .5, .4, .25, .1]),
    "sett": ([0, 0, 0, 0, 0, 0, 0, .05, .1, .15, .25, .55, .8, .65, .35, .3, .35, .45, .55, .6, .55, .45, .3, .1],
             [0, 0, 0, 0, 0, 0, 0, .02, .05, .1, .2, .4, .5, .45, .35, .35, .4, .5, .62, .7, .66, .55, .35, .12]),
    "strada": ([0, 0, 0, 0, 0, 0, 0, .35, .8, .7, .55, .6, .85, .75, .45, .4, .35, .25, .15, .05, 0, 0, 0, 0],
               [0, 0, 0, 0, 0, 0, 0, .1, .3, .45, .5, .55, .6, .5, .35, .25, .15, .1, .05, 0, 0, 0, 0, 0]),
}
# Weekday multiplier, Monday=0. Friday/Saturday nights run hotter at the Sett and Terrace.
_DOW = {"terrace": [.9, .9, .95, 1.0, 1.15, 1.2, 1.0], "rathskeller": [1.0, 1.0, 1.0, 1.05, 1.1, 1.0, .85],
        "sett": [.9, .9, .95, 1.0, 1.1, 1.1, .9], "strada": [1.05, 1.05, 1.0, 1.0, .9, .6, .6]}
SALES_PER_HOUR_AT_PEAK = 140  # Strada items per hour at full busyness
# The Terrace is outdoors: monthly factor (Jan..Dec), interpolated by day so the season changes smoothly.
_SEASON = {"terrace": [.25, .3, .45, .7, .9, 1, 1, 1, .9, .7, .45, .3]}


def season(venue_id: str, lt: datetime) -> float:
    f = _SEASON.get(venue_id)
    if not f:
        return 1.0
    frac = (lt.day - 1) / 31  # move toward next month's factor as the month goes on
    return f[lt.month - 1] + (f[lt.month % 12] - f[lt.month - 1]) * frac


def _noise(*key) -> float:
    """Deterministic noise in [-1, 1] for a (venue, metric, time) key, so reruns write identical rows."""
    h = hashlib.sha256("|".join(map(str, key)).encode()).digest()
    return int.from_bytes(h[:8], "big") / 2**63 - 1


def busyness(venue_id: str, t: datetime) -> float:
    """0..~1.2 busyness at UTC time t, interpolated between local hours, with day-of-week and noise."""
    lt = t.astimezone(LOCAL)
    weekday, weekend = _PROFILES[venue_id]
    prof = weekend if lt.weekday() >= 5 else weekday
    h = lt.hour + lt.minute / 60
    a, b = prof[int(h) % 24], prof[(int(h) + 1) % 24]
    base = a + (b - a) * (h - int(h))
    day = lt.date().toordinal()
    daily = 1 + 0.12 * _noise(venue_id, "day", day)  # some days are just busier
    return max(0.0, base * _DOW[venue_id][lt.weekday()] * season(venue_id, lt) * daily * (1 + 0.08 * _noise(venue_id, t.isoformat())))


def reading(venue_id: str, t: datetime) -> list[dict]:
    """All simulated metrics for one venue at UTC time t."""
    v = VENUES[venue_id]
    x = busyness(venue_id, t)
    rows = []
    if "people" in v["metrics"]:
        people = round(min(v["capacity"] * 0.98, v["capacity"] * x))  # sensors rarely read a room as full
        rows += [("people", people), ("occupancy_pct", round(100 * people / v["capacity"], 1))]
    if "line_len" in v["metrics"]:
        line = max(0, round(16 * x + 2 * _noise(venue_id, "line", t.isoformat())))
        rows += [("line_len", line), ("wait_min", round(max(0.0, 0.75 * line + 0.5 * _noise(venue_id, "wait", t.isoformat())), 1))]
    if "sales" in v["metrics"]:
        rows.append(("sales", daily_sales(venue_id, t)))
    return [{"venue_id": venue_id, "metric": m, "value": float(val), "observed_at": t, "source": "sim", "is_simulated": True}
            for m, val in rows]


def daily_sales(venue_id: str, t: datetime) -> int:
    """Cumulative items sold since local midnight (sum of 5-minute busyness)."""
    lt = t.astimezone(LOCAL)
    start = lt.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    total, s = 0.0, start
    while s < t:
        total += busyness(venue_id, s) * SALES_PER_HOUR_AT_PEAK / 12
        s += STEP
    return round(total)


def floor_step(t: datetime) -> datetime:
    t = t.astimezone(timezone.utc).replace(second=0, microsecond=0)
    return t - timedelta(minutes=t.minute % 5)


def readings(t: datetime, venue_ids=None) -> list[dict]:
    t = floor_step(t)
    return [r for vid in (venue_ids or VENUES) for r in reading(vid, t)]


def backfill(end: datetime, days: int = 30, venue_ids=None) -> list[dict]:
    """5-minute history for the last `days` days, so baselines and thresholds exist from day one."""
    end = floor_step(end)
    t = end - timedelta(days=days)
    out = []
    while t <= end:
        out += readings(t, venue_ids)
        t += STEP
    return out


def busy_level(pct: float | None) -> str:
    """Waitz-style label for an occupancy percentage."""
    if pct is None or math.isnan(pct):
        return "unknown"
    return "Very busy" if pct >= 75 else "Busy" if pct >= 45 else "Not busy"
