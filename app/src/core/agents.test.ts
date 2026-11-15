import { describe, expect, it } from "vitest";
import { belief, decide, decideSell, momentum, poisson, rng, type Ctx } from "./agents";

const ctx = (over: Partial<Ctx> = {}): Ctx => ({
  prices: [0.5, 0.5],
  belief: [0.5, 0.5],
  recent: [],
  held: [0, 0],
  basis: [0, 0],
  worth: [0, 0],
  balance: 100,
  rand: rng(7),
  ...over,
});

describe("belief (hidden true odds)", () => {
  it("is deterministic, valid and moves over time", () => {
    const t0 = Date.parse("2026-11-15T03:00:00Z");
    expect(belief("m-x", 2, t0)).toEqual(belief("m-x", 2, t0));
    for (const n of [2, 4]) {
      const b = belief("m-x", n, t0);
      expect(b.reduce((a, x) => a + x, 0)).toBeCloseTo(1, 2);
      b.forEach((x) => expect(x > 0 && x < 1).toBe(true));
    }
    const path = Array.from({ length: 24 }, (_, h) => belief("m-x", 2, t0 + h * 3600e3)[0]);
    expect(Math.max(...path) - Math.min(...path)).toBeGreaterThan(0.1); // it really drifts over a day
    expect(belief("m-y", 2, t0)[0]).not.toBe(belief("m-x", 2, t0)[0]); // markets differ
  });
});

describe("agent styles", () => {
  it("sharp buys the underpriced side, skips without an edge", () => {
    for (let s = 0; s < 20; s++) {
      const d = decide("sharp", ctx({ belief: [0.7, 0.3], rand: rng(s) }));
      if (d.kind === "buy" && !d.whale) expect(d.outcome).toBe(0);
    }
    const skips = Array.from({ length: 30 }, (_, s) => decide("sharp", ctx({ rand: rng(s) }))).filter((d) => d.kind === "skip");
    expect(skips.length).toBeGreaterThan(20);
  });

  it("herd follows momentum, contrarian fades it", () => {
    const recent = [[0.4, 0.6], [0.45, 0.55], [0.55, 0.45]];
    for (let s = 0; s < 20; s++) {
      const h = decide("herd", ctx({ recent, rand: rng(s) }));
      const c = decide("contrarian", ctx({ recent, rand: rng(s) }));
      if (h.kind === "buy" && !h.whale) expect(h.outcome).toBe(0);
      if (c.kind === "buy" && !c.whale) expect(c.outcome).toBe(1);
    }
    expect(momentum(recent, 2).map((x) => +x.toFixed(2))).toEqual([0.15, -0.15]);
  });

  it("buys are whole Clout, affordable, and whales are 40-150", () => {
    let whales = 0;
    for (let s = 0; s < 400; s++) {
      const d = decide("noise", ctx({ rand: rng(s), balance: 200 }));
      if (d.kind !== "buy") continue;
      expect(Number.isInteger(d.clout)).toBe(true);
      expect(d.clout).toBeGreaterThanOrEqual(1);
      if (d.whale) {
        whales++;
        expect(d.clout >= 40 && d.clout <= 150).toBe(true);
      } else expect(d.clout).toBeLessThanOrEqual(8);
    }
    expect(whales).toBeGreaterThan(0);
    expect(decide("noise", ctx({ balance: 0.5 })).kind).toBe("skip"); // broke
  });

  it("sellers ask for whole Clout within the position's worth, or sell all", () => {
    for (let s = 0; s < 50; s++) {
      const d = decideSell(ctx({ held: [20, 0], basis: [10, 0], worth: [10.5, 0], rand: rng(s) }))!;
      expect(d.kind).toBe("sell");
      if (d.kind === "sell" && d.clout !== "all") {
        expect(Number.isInteger(d.clout)).toBe(true);
        expect(d.clout).toBeLessThanOrEqual(10.5);
      }
    }
    // big profit or big loss: sell everything
    expect(decideSell(ctx({ held: [20, 0], basis: [10, 0], worth: [15, 0] }))).toEqual({ kind: "sell", outcome: 0, clout: "all" });
    expect(decideSell(ctx({ held: [20, 0], basis: [10, 0], worth: [4, 0] }))).toEqual({ kind: "sell", outcome: 0, clout: "all" });
    expect(decideSell(ctx())).toBeNull();
  });

  it("trade counts average the rate and respect the cap", () => {
    const r = rng(3);
    const xs = Array.from({ length: 2000 }, () => poisson(6, r));
    const mean = xs.reduce((a, x) => a + x, 0) / xs.length;
    expect(mean).toBeGreaterThan(5.5);
    expect(mean).toBeLessThan(6.5);
    expect(Math.max(...xs)).toBeLessThanOrEqual(20);
  });
});
