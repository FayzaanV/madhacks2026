import { describe, expect, it } from "vitest";
import { chicagoToIso, denyReason, parseSchedule, winnerOutcome, type ImGame } from "./intramurals";

const base: ImGame = { status: "scheduled", starts_at: "2026-11-18T01:30:00Z", home_captain: "A", away_captain: "B", reported_by: null };
const after = Date.parse("2026-11-18T03:00:00Z");

describe("captain flow", () => {
  it("only captains, only after start", () => {
    expect(denyReason(base, "C", "report", after)).toMatch(/captains/);
    expect(denyReason(base, "A", "report", Date.parse("2026-11-18T01:00:00Z"))).toMatch(/hasn't started/);
    expect(denyReason(base, "A", "report", after)).toBeNull();
  });
  it("the opponent confirms or disputes; the reporter can't", () => {
    const reported = { ...base, status: "reported" as const, reported_by: "A" };
    expect(denyReason(reported, "B", "confirm", after)).toBeNull();
    expect(denyReason(reported, "B", "dispute", after)).toBeNull();
    expect(denyReason(reported, "A", "confirm", after)).toMatch(/other team/);
    expect(denyReason(reported, "A", "report", after)).toBeNull(); // can correct own report
    expect(denyReason(reported, "B", "report", after)).toMatch(/confirm or dispute/);
  });
  it("nothing to confirm on a final or disputed game", () => {
    expect(denyReason({ ...base, status: "final", reported_by: "A" }, "B", "confirm", after)).toMatch(/no reported score/);
    expect(denyReason({ ...base, status: "disputed", reported_by: "A" }, "B", "report", after)).toMatch(/disputed/);
  });
});

describe("winnerOutcome", () => {
  it("home win = Yes, away win = No, tie or cancel voids", () => {
    expect(winnerOutcome("final", 21, 14)).toBe(0);
    expect(winnerOutcome("final", 3, 5)).toBe(1);
    expect(winnerOutcome("final", 2, 2)).toBe("void");
    expect(winnerOutcome("canceled", 1, 0)).toBe("void");
  });
});

describe("schedule import", () => {
  it("parses rows, skips header, reports bad lines", () => {
    const { rows, errors } = parseSchedule("date,time,home,away,location\n2026-11-18,19:30,Ballers,Dunkers,Nat Gym\nbad,line\n2026-11-19,20:00,X,X,");
    expect(rows).toEqual([{ date: "2026-11-18", time: "19:30", home: "Ballers", away: "Dunkers", location: "Nat Gym" }]);
    expect(errors).toHaveLength(2);
  });
  it("Central time to UTC across DST", () => {
    expect(chicagoToIso("2026-11-18", "19:30")).toBe("2026-11-19T01:30:00.000Z"); // CST, UTC-6
    expect(chicagoToIso("2026-09-10", "19:30")).toBe("2026-09-11T00:30:00.000Z"); // CDT, UTC-5
  });
});
