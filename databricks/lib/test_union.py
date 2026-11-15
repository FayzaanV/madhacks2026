"""Tests for venues.py and union.py. Run: cd databricks/lib && python3 -m unittest test_union"""
import math
import unittest
from datetime import date, datetime, timedelta, timezone

import union as u
import venues as v
from venues import LOCAL


def local(y, m, d, hh, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=LOCAL).astimezone(timezone.utc)


class TestSimulator(unittest.TestCase):
    def test_deterministic_and_shaped(self):
        t = local(2026, 11, 13, 19)  # Friday 7pm
        self.assertEqual(v.reading("sett", t), v.reading("sett", t))
        night = v.reading("sett", local(2026, 11, 13, 19))
        dawn = v.reading("sett", local(2026, 11, 13, 4))
        pct = lambda rows: next(r["value"] for r in rows if r["metric"] == "occupancy_pct")
        self.assertGreater(pct(night), 30)
        self.assertEqual(pct(dawn), 0)
        for r in night:
            self.assertEqual((r["source"], r["is_simulated"]), ("sim", True))

    def test_metrics_per_venue(self):
        t = local(2026, 11, 12, 12)
        self.assertEqual({r["metric"] for r in v.reading("strada", t)}, {"wait_min", "line_len", "sales"})
        self.assertEqual({r["metric"] for r in v.reading("terrace", t)}, {"people", "occupancy_pct"})

    def test_sales_cumulative(self):
        s = [v.daily_sales("strada", local(2026, 11, 12, h)) for h in (8, 12, 16)]
        self.assertTrue(s[0] < s[1] < s[2])
        self.assertEqual(v.daily_sales("strada", local(2026, 11, 12, 0, 0)), 0)

    def test_backfill_steps(self):
        rows = v.backfill(local(2026, 11, 12, 12), days=1, venue_ids=["sett"])
        times = sorted({r["observed_at"] for r in rows})
        self.assertEqual(times[1] - times[0], timedelta(minutes=5))
        self.assertEqual(len(times), 24 * 12 + 1)

    def test_busy_level(self):
        self.assertEqual([v.busy_level(x) for x in (10, 50, 90)], ["Not busy", "Busy", "Very busy"])
        self.assertEqual(v.busy_level(None), "unknown")


class TestTemplates(unittest.TestCase):
    def test_market_for(self):
        t = u.TEMPLATES[0]  # sett 7pm occupancy
        m = u.market_for(t, date(2026, 11, 14), 61.7)
        self.assertEqual(m["market_id"], "m-union-sett-busy-7pm-2026-11-14")
        self.assertEqual(m["rule"]["threshold"], 60.0)
        self.assertIn("60%", m["question"])
        self.assertEqual(m["rule"]["window_start"], local(2026, 11, 14, 19))
        self.assertEqual(m["closes_at"], local(2026, 11, 14, 18, 45))
        self.assertIsNone(u.market_for(t, date(2026, 11, 14), None))

    def test_baseline_from_history(self):
        t = u.TEMPLATES[0]
        rows = [(r["observed_at"], r["value"]) for r in v.backfill(local(2026, 11, 14, 6), days=21, venue_ids=["sett"])
                if r["metric"] == "occupancy_pct"]
        b = u.baseline(t, rows, date(2026, 11, 14))
        self.assertIsNotNone(b)
        self.assertTrue(20 < b < 100)
        self.assertIsNone(u.baseline(t, [], date(2026, 11, 14)))

    def test_round_threshold(self):
        self.assertEqual(u.round_threshold("people", 312), 300)
        self.assertEqual(u.round_threshold("sales", 4), 10)  # never below one step


class TestEvaluate(unittest.TestCase):
    rule = {"venue_id": "sett", "metric": "occupancy_pct", "op": ">=", "threshold": 60.0, "agg": "avg"}

    def rows(self, src, vals):
        t0 = local(2026, 11, 14, 19)
        return [{"source": src, "value": x, "observed_at": t0 + timedelta(minutes=5 * i)} for i, x in enumerate(vals)]

    def test_priority_partner_over_sensor_over_sim(self):
        data = self.rows("sim", [90, 90]) + self.rows("occuspace", [40, 50]) + self.rows("partner", [70])
        w, why = u.evaluate(self.rule, data)
        self.assertEqual(w, 0)
        self.assertIn("partner", why)
        w, why = u.evaluate(self.rule, self.rows("sim", [90]) + self.rows("occuspace", [40, 50]))
        self.assertEqual(w, 1)  # sensor beats sim even though sim says yes
        self.assertIn("occuspace", why)

    def test_aggregations(self):
        data = self.rows("sim", [50, 80, 55])
        self.assertEqual(u.evaluate({**self.rule, "agg": "avg"}, data)[0], 0)  # avg 61.7
        self.assertEqual(u.evaluate({**self.rule, "agg": "last"}, data)[0], 1)  # 55
        self.assertEqual(u.evaluate({**self.rule, "agg": "max", "threshold": 81}, data)[0], 1)

    def test_reports_fallback_and_void(self):
        r = [{"value": x} for x in (55, 70, 65)]
        w, why = u.evaluate(self.rule, [], r)
        self.assertEqual(w, 0)
        self.assertIn("median of 3 student reports", why)
        self.assertEqual(u.evaluate(self.rule, [], r[:2])[0], "void")

    def test_less_than(self):
        self.assertEqual(u.evaluate({**self.rule, "op": "<"}, self.rows("sim", [50]))[0], 0)


class TestCredits(unittest.TestCase):
    # (user, outcome, clout_spent, shares); sells are negative
    trades = [("a", 0, 10, 19.8), ("a", 0, -4, -7.5), ("b", 1, 6, 12.0), ("c", 0, 5, 9.0), ("c", 0, -6, -9.0)]

    def test_yes_wins(self):
        got = u.credits(self.trades, 0)
        self.assertTrue(math.isclose(got["a"], 12.3))  # shares still held
        self.assertNotIn("b", got)  # lost, nothing back
        self.assertNotIn("c", got)  # sold everything before settlement

    def test_void_reverses_net_cash(self):
        got = u.credits(self.trades, "void")
        self.assertEqual(got, {"a": 6, "b": 6, "c": -1})  # c sold for a profit; voiding takes it back


if __name__ == "__main__":
    unittest.main()
