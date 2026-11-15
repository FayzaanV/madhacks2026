"""Occuspace (Waitz) live occupancy adapter.

UW-Madison already runs Occuspace sensors in the Terrace, Rathskeller and Sett. Occuspace gives partners a bearer
token and REST endpoints returning the current count, capacity and percent occupied
(https://docs.occuspace.io/guides/using-live-data).

UNVERIFIED: we don't have a token yet, so BASE_URL, the path and the field names below follow the public docs'
description and must be checked against https://occuspace.io/api once the Union issues a token. Everything
Occuspace-specific is in this file; the rest of the pipeline only sees venue_metrics rows.
"""
from __future__ import annotations

import json
import urllib.request
from datetime import datetime, timezone

BASE_URL = "https://api.occuspace.io/v1"  # TODO: confirm with the token's API docs


def fetch(token: str, external_id: str, capacity: int, venue_id: str, timeout: float = 10) -> list[dict]:
    """Current reading for one space as venue_metrics rows (source='occuspace'). Raises on HTTP/shape errors."""
    req = urllib.request.Request(f"{BASE_URL}/location/{external_id}/now", headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return parse(json.load(resp), capacity, venue_id)


def parse(payload: dict, capacity: int, venue_id: str) -> list[dict]:
    data = payload.get("data", payload)
    count = data.get("count", data.get("occupancy"))  # TODO: confirm field names
    if count is None:
        raise ValueError(f"Occuspace response has no count: {list(data)}")
    pct = data.get("percentage")
    pct = float(pct) * (100 if pct is not None and float(pct) <= 1 else 1) if pct is not None else 100 * float(count) / capacity
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    return [{"venue_id": venue_id, "metric": m, "value": float(v), "observed_at": now, "source": "occuspace", "is_simulated": False}
            for m, v in (("people", count), ("occupancy_pct", round(pct, 1)))]
