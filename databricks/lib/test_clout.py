"""Tests for clout.py against the shared vectors. Run: python3 -m unittest discover databricks/lib"""
import json
import math
import os
import unittest

import clout as c

HERE = os.path.dirname(os.path.abspath(__file__))
V = json.load(open(os.path.join(HERE, "..", "..", "lib", "test-vectors.json")))
TOL = V["tolerance"]


def close(a, b):
    return math.isclose(a, b, rel_tol=TOL, abs_tol=TOL)


class TestVectors(unittest.TestCase):
    def test_lmsr(self):
        for v in V["lmsr"]:
            q, b, i, a = v["q"], v["b"], v["i"], v["amount"]
            self.assertTrue(close(c.cost(q, b), v["cost"]))
            for p, e in zip(c.prices(q, b), v["prices"]):
                self.assertTrue(close(p, e))
            shares = c.shares_for_amount(q, i, a, b)
            self.assertTrue(close(shares, v["shares"]))
            # buying those shares costs exactly the amount spent
            self.assertTrue(math.isclose(c.cost_to_buy(q, i, shares, b), a, rel_tol=1e-9, abs_tol=1e-6))
            self.assertTrue(close(c.apply_trade(q, i, a, b)[2], v["post_price"]))

    def test_rules(self):
        for v in V["max_bet"]:
            self.assertEqual(c.max_bet(v["clout"]), v["max_bet"])
        for v in V["remaining_bet"]:
            self.assertEqual(c.remaining_bet(v["clout"], v["staked"]), v["remaining"])
        for v in V["privileges"]:
            self.assertEqual(c.privileges(v["clout"]), v["privileges"])
        for v in V["net_clout_change"]:
            self.assertTrue(close(c.net_clout_change(v["trades"], v["winner"]), v["net"]))
        for v in V["smart_money"]:
            got = c.smart_money(v["stakes"], v["n"])
            if v["smart_money"] is None:
                self.assertIsNone(got)
            else:
                for a, b in zip(got, v["smart_money"]):
                    self.assertTrue(close(a, b))

    def test_scoring(self):
        for v in V["brier"]:
            self.assertTrue(close(c.brier(v["f"], v["o"]), v["brier"]))
        cal = V["calibration"]
        self.assertEqual(c.calibration_curve(cal["pairs"]), cal["curve"])
        self.assertTrue(close(c.mean_brier(cal["pairs"]), cal["mean_brier"]))


class TestProperties(unittest.TestCase):
    def test_prices_sum_to_one(self):
        for q in ([0, 0], [10, -3, 400], [5000, 0]):
            self.assertAlmostEqual(sum(c.prices(q, 100)), 1.0, places=12)

    def test_small_bet_moves_binary_about_one_point(self):
        _, _, post = c.apply_trade([0, 0], 0, 10)
        self.assertTrue(0.005 < post - 0.5 < 0.015)

    def test_min_bet_always_allowed(self):
        self.assertEqual(c.max_bet(-10_000), 10)


if __name__ == "__main__":
    unittest.main()
