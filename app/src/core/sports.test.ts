import { describe, expect, it } from "vitest";
import fx from "./fixtures/espn-events.json";
import { prices } from "./lmsr";
import { closesAt, decidedEarly, marketsForGame, openingProbs, parseEvent, ratingWinProb, resolveOutcome, scoreLine, sharesForProbs, SPORTS, totalLine, type SportKey } from "./sports";

type Fixture = { sport: SportKey; event: Parameters<typeof parseEvent>[1] };
const game = (k: keyof typeof fx) => {
  const f = fx[k] as unknown as Fixture;
  return parseEvent(f.sport, f.event);
};

describe("parseEvent", () => {
  it("final football game (Wisconsin at Maryland, 21–24)", () => {
    const g = game("football_final");
    expect(g.eventId).toBe("401858520");
    expect(g.state).toBe("post");
    expect(g.completed).toBe(true);
    expect(g.home).toMatchObject({ abbr: "MD", score: 24, winner: true, schoolId: "umd" });
    expect(g.away).toMatchObject({ abbr: "WIS", score: 21, schoolId: "uw-madison" });
    expect(g.winnerSide).toBe("home");
    expect(g.overtime).toBe(false);
  });
  it("live game is not completed", () => {
    const g = game("football_live");
    expect(g.state).toBe("in");
    expect(g.completed).toBe(false);
  });
  it("detects overtime from 'Final/OT'", () => {
    const g = game("hockey_ot_final");
    expect(g.overtime).toBe(true);
    expect(g.winnerSide).toBe("away");
  });
});

describe("marketsForGame", () => {
  it("Big Ten matchup gets one set of markets, phrased from the home school", () => {
    const g = game("football_final");
    const specs = marketsForGame(g, 47.5);
    expect(specs.map((s) => s.kind)).toEqual(["winner", "total", "margin", "overtime"]);
    expect(specs[0].question).toMatch(/^Football: Will Maryland beat Wisconsin\?/);
    expect(specs[0].schoolId).toBe("umd");
    expect(specs[2].outcomes).toEqual([
      "Maryland by 1–7", "Maryland by 8–14", "Maryland by 15+", "Wisconsin by 1–7", "Wisconsin by 8–14", "Wisconsin by 15+",
    ]);
  });
  it("games with no listed school get no markets", () => {
    expect(marketsForGame(game("hockey_ot_final"), 5.5)).toEqual([]);
  });
  it("volleyball has set-based margins and no overtime market", () => {
    const g = { ...game("football_final"), sport: "womens-volleyball" as const };
    const specs = marketsForGame(g, 3.5);
    expect(specs.map((s) => s.kind)).toEqual(["winner", "total", "margin"]);
    expect(specs[2].outcomes.slice(0, 3)).toEqual(["Maryland 3–0", "Maryland 3–1", "Maryland 3–2"]);
  });
});

describe("resolveOutcome", () => {
  const g = game("football_final"); // MD 24, WIS 21, regulation
  it("winner / total / margin / overtime from the home side", () => {
    expect(resolveOutcome({ kind: "winner", line: null, focus: "home" }, g)).toBe(0); // Maryland won: Yes
    expect(resolveOutcome({ kind: "winner", line: null, focus: "away" }, g)).toBe(1); // Wisconsin lost: No
    expect(resolveOutcome({ kind: "total", line: 44.5, focus: "home" }, g)).toBe(0); // 45 > 44.5: Over
    expect(resolveOutcome({ kind: "total", line: 47.5, focus: "home" }, g)).toBe(1);
    expect(resolveOutcome({ kind: "margin", line: null, focus: "home" }, g)).toBe(0); // Maryland by 3 -> "by 1–7"
    expect(resolveOutcome({ kind: "margin", line: null, focus: "away" }, g)).toBe(3); // opp bucket "Maryland by 1–7"
    expect(resolveOutcome({ kind: "overtime", line: null, focus: "home" }, g)).toBe(1);
  });
  it("overtime game resolves overtime Yes", () => {
    expect(resolveOutcome({ kind: "overtime", line: null, focus: "home" }, game("hockey_ot_final"))).toBe(0);
  });
  it("live game is undecided", () => {
    expect(resolveOutcome({ kind: "winner", line: null, focus: "home" }, game("football_live"))).toBeNull();
  });
  it("postponed game voids every market", () => {
    for (const kind of ["winner", "total", "margin", "overtime"] as const)
      expect(resolveOutcome({ kind, line: 40.5, focus: "home" }, game("postponed"))).toBe("void");
  });
  it("a tie voids winner and margin", () => {
    const tie = { ...g, home: { ...g.home, score: 3 }, away: { ...g.away, score: 3 } };
    expect(resolveOutcome({ kind: "winner", line: null, focus: "home" }, tie)).toBe("void");
    expect(resolveOutcome({ kind: "margin", line: null, focus: "home" }, tie)).toBe("void");
  });
});

describe("helpers", () => {
  it("total line is a .5 so there are no pushes; falls back to sport default", () => {
    expect(totalLine("football", [40, 51, 47])).toBe(46.5);
    expect(totalLine("football", [])).toBe(SPORTS.football.defaultTotal);
  });
  it("score line", () => {
    expect(scoreLine(game("football_final"))).toBe("WIS 21 – MD 24 · Final");
  });
});

describe("real-world opening odds", () => {
  const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
  it("winner opens at the favorite's chance; LMSR shares reproduce it", () => {
    const p = openingProbs("winner", "football", 0.842);
    expect(p[0]).toBeCloseTo(0.842, 6);
    const q = sharesForProbs(p, 300);
    expect(prices(q, 300)[0]).toBeCloseTo(0.842, 6);
  });
  it("margin buckets favor the favorite and sum to 1", () => {
    const fav = openingProbs("margin", "football", 0.85);
    expect(sum(fav)).toBeCloseTo(1, 9);
    expect(sum(fav.slice(0, 3))).toBeGreaterThan(0.75); // focus wins most of the time
    expect(fav[2]).toBeGreaterThan(fav[5]); // "by 15+" far likelier for the favorite
    const even = openingProbs("margin", "mens-basketball", 0.5);
    expect(sum(even.slice(0, 3))).toBeCloseTo(0.5, 2);
  });
  it("volleyball set margins and overtime base rates", () => {
    expect(sum(openingProbs("margin", "womens-volleyball", 0.7))).toBeCloseTo(1, 9);
    expect(openingProbs("overtime", "mens-hockey", 0.5)[0]).toBeCloseTo(0.22, 6);
    expect(openingProbs("total", "football", 0.9)).toEqual([0.5, 0.5]);
  });
  it("rating fallback: better margin + home edge -> favorite", () => {
    expect(ratingWinProb("mens-hockey", 1.5, -0.5)).toBeGreaterThan(0.6);
    expect(ratingWinProb("mens-hockey", 0, 0)).toBeGreaterThan(0.5); // home edge
    expect(ratingWinProb("mens-hockey", -3, 3)).toBeLessThan(0.3);
  });
});

describe("live trading windows", () => {
  const start = "2026-11-21T17:00:00.000Z";
  it("winner trades live only where ESPN has live odds; totals always; margin/OT close at start", () => {
    expect(closesAt("winner", "football", start)).toBe("2026-11-21T21:30:00.000Z");
    expect(closesAt("winner", "mens-hockey", start)).toBe(start);
    expect(closesAt("total", "mens-hockey", start)).toBe("2026-11-21T20:30:00.000Z");
    expect(closesAt("margin", "football", start)).toBe(start);
    expect(closesAt("overtime", "mens-basketball", start)).toBe(start);
  });
  it("over/under settles Over as soon as the line is passed; OT settles once in overtime", () => {
    const live = game("football_live"); // MSU 14 - WASH 21, in progress
    expect(decidedEarly({ kind: "total", line: 30.5 }, live)).toBe(0);
    expect(decidedEarly({ kind: "total", line: 40.5 }, live)).toBeNull();
    expect(decidedEarly({ kind: "overtime", line: null }, { ...live, overtime: true })).toBe(0);
    expect(decidedEarly({ kind: "total", line: 30.5 }, game("football_final"))).toBeNull(); // final: normal path
  });
});
