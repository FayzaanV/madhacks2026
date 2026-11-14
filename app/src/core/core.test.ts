import { describe, expect, it } from "vitest";
import vectors from "../../../lib/test-vectors.json";
import { applyTrade, cost, costToBuy, prices, sharesForAmount } from "./lmsr";
import { STARTING_CLOUT, canAfford, netCloutChange, privileges, smartMoney } from "./clout";
import { brier, calibrationCurve, meanBrier } from "./scoring";

const TOL = vectors.tolerance;
const close = (a: number, b: number, tol = TOL) =>
  expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.max(tol, tol * Math.abs(b)));

describe("shared vectors (must match databricks/lib/clout.py)", () => {
  it("LMSR", () => {
    for (const v of vectors.lmsr) {
      close(cost(v.q, v.b), v.cost);
      prices(v.q, v.b).forEach((p, j) => close(p, v.prices[j]));
      const shares = sharesForAmount(v.q, v.i, v.amount, v.b);
      close(shares, v.shares);
      close(costToBuy(v.q, v.i, shares, v.b), v.amount, 1e-6);
      close(applyTrade(v.q, v.i, v.amount, v.b).postPrice, v.post_price);
    }
  });

  it("Clout rules", () => {
    expect(STARTING_CLOUT).toBe(vectors.starting_clout);
    for (const v of vectors.can_afford) expect(canAfford(v.balance, v.amount)).toBe(v.ok);
    for (const v of vectors.privileges) expect(privileges(v.clout)).toEqual(v.privileges);
    for (const v of vectors.net_clout_change)
      close(netCloutChange(v.trades as [number, number, number][], v.winner), v.net);
    for (const v of vectors.smart_money) {
      const got = smartMoney(v.stakes as [number, number, number][], v.n);
      if (v.smart_money === null) expect(got).toBeNull();
      else got!.forEach((x, k) => close(x, v.smart_money![k]));
    }
  });

  it("scoring", () => {
    for (const v of vectors.brier) close(brier(v.f, v.o), v.brier);
    const pairs = vectors.calibration.pairs as [number, number][];
    const curve = calibrationCurve(pairs);
    expect(curve.map((c) => [c.bucket, c.n])).toEqual(vectors.calibration.curve.map((c) => [c.bucket, c.n]));
    curve.forEach((c, k) => {
      close(c.mean_forecast, vectors.calibration.curve[k].mean_forecast);
      close(c.hit_rate, vectors.calibration.curve[k].hit_rate);
    });
    close(meanBrier(pairs)!, vectors.calibration.mean_brier);
  });
});

describe("properties", () => {
  it("prices sum to 1, even with huge q", () => {
    for (const q of [[0, 0], [10, -3, 400], [5000, 0]]) close(prices(q, 100).reduce((a, x) => a + x), 1, 1e-12);
  });
  it("a 10-Clout bet moves a 50/50 market ~1 point", () => {
    const d = applyTrade([0, 0], 0, 10).postPrice - 0.5;
    expect(d).toBeGreaterThan(0.005);
    expect(d).toBeLessThan(0.015);
  });
  it("cannot bet more than your balance", () => {
    expect(canAfford(100, 100)).toBe(true);
    expect(canAfford(100, 101)).toBe(false);
  });
});
