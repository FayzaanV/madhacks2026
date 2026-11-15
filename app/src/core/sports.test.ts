import { describe, expect, it } from "vitest";
import fx from "./fixtures/espn-events.json";
import { marketsForGame, parseEvent, resolveOutcome, scoreLine, SPORTS, totalLine, type SportKey } from "./sports";

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
