import { describe, expect, it } from "vitest";
import vectors from "../../../lib/test-vectors.json";
import { applySell, applyTrade, cost, costToBuy, prices, sellProceeds, sharesForAmount, sharesForProceeds } from "./lmsr";
import { STARTING_CLOUT, canAfford, netCloutChange, privileges, sellBasis, smartMoney } from "./clout";
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

  it("LMSR selling", () => {
    for (const v of vectors.sell) {
      const r = applySell(v.q, v.i, v.shares, v.b);
      close(r.proceeds, v.proceeds);
      close(r.postPrice, v.post_price);
      r.newQ.forEach((x, j) => close(x, v.new_q[j]));
    }
    for (const v of vectors.round_trip) {
      const { newQ, shares } = applyTrade(v.q, v.i, v.amount, v.b);
      close(sellProceeds(newQ, v.i, shares, v.b), v.amount, 1e-6);
      close(v.proceeds, v.amount, 1e-6);
    }
    for (const v of vectors.sell_for) {
      const k = sharesForProceeds(v.q, v.i, v.amount, v.b);
      close(k, v.shares);
      close(sellProceeds(v.q, v.i, k, v.b), v.amount, 1e-6);
    }
    expect(Number.isNaN(sharesForProceeds([0, 0], 0, 10_000, 500))).toBe(true);
    for (const v of vectors.sell_basis) close(sellBasis(v.basis, v.position, v.shares), v.removed);
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

describe("Madison time", () => {
  it("formats a UTC instant in Central time", async () => {
    const { fmtDateTime, fromMadison, madisonAt } = await import("./time");
    expect(fmtDateTime("2026-11-15T01:33:00Z")).toBe("Nov 14, 7:33 PM CT"); // CST, UTC-6
    expect(fmtDateTime("2026-07-04T23:00:00Z")).toBe("Jul 4, 6:00 PM CT"); // CDT, UTC-5
    expect(fromMadison("2026-11-14T19:30").toISOString()).toBe("2026-11-15T01:30:00.000Z");
    expect(fromMadison("2026-07-04T18:00").toISOString()).toBe("2026-07-04T23:00:00.000Z");
    expect(madisonAt(new Date("2026-11-15T01:33:00Z"), 23, 30).toISOString()).toBe("2026-11-15T05:30:00.000Z");
  });
});

describe("test markets", () => {
  it("closes every 30 min tonight, or spreads over 3h when late", async () => {
    const { closeTimes } = await import("./testmarkets");
    const evening = closeTimes(new Date("2026-11-15T00:05:00Z"), 8); // 6:05pm CT
    expect(evening[0].toISOString()).toBe("2026-11-15T00:30:00.000Z");
    expect(evening[7].toISOString()).toBe("2026-11-15T04:00:00.000Z"); // 10:00pm CT, before 11:30
    const late = closeTimes(new Date("2026-11-15T05:00:00Z"), 8); // 11:00pm CT
    expect(late[0].getTime()).toBeGreaterThan(Date.parse("2026-11-15T05:15:00Z"));
    expect(late[7].getTime() - late[0].getTime()).toBe(3 * 3600e3);
    for (let i = 1; i < late.length; i++) expect(late[i].getTime()).toBeGreaterThan(late[i - 1].getTime());
  });

  it("picks winners in proportion to the odds", async () => {
    const { weightedPick } = await import("./testmarkets");
    expect([0, 0.29, 0.31, 0.99].map((r) => weightedPick([0.3, 0.7], r))).toEqual([0, 0, 1, 1]);
  });
});

describe("settlement and override", () => {
  // [user, outcome, clout_spent, shares]; sells are negative (same case as databricks/lib/test_union.py)
  const trades = [
    ["a", 0, 10, 19.8],
    ["a", 0, -4, -7.5],
    ["b", 1, 6, 12.0],
    ["c", 0, 5, 9.0],
    ["c", 0, -6, -9.0],
  ] as const;

  it("pays shares still held, or reverses net cash on void", async () => {
    const { settlementCredits } = await import("./clout");
    const yes = settlementCredits(trades, 0);
    close(yes.get("a")!, 12.3);
    expect(yes.has("b")).toBe(false);
    expect(yes.has("c")).toBe(false);
    expect(Object.fromEntries(settlementCredits(trades, "void"))).toEqual({ a: 6, b: 6, c: -1 });
  });

  it("override moves balances by exactly new - old", async () => {
    const { overrideDeltas, settlementCredits } = await import("./clout");
    for (const [from, to] of [[0, 1], [1, "void"], ["void", 0]] as const) {
      const d = overrideDeltas(trades, from, to);
      const before = settlementCredits(trades, from);
      const after = settlementCredits(trades, to);
      for (const u of ["a", "b", "c"]) close((before.get(u) ?? 0) + (d.get(u) ?? 0), after.get(u) ?? 0);
    }
    close(overrideDeltas(trades, 0, 1).get("a")!, -12.3);
    close(overrideDeltas(trades, 0, 1).get("b")!, 12);
  });
});
