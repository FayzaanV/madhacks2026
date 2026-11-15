import { describe, expect, it } from "vitest";
import {
  chicagoMidnight,
  latestClose,
  parseChicagoLocal,
  pickReading,
  readingValue,
  resolvableAt,
  suggestQuestion,
  validateRule,
  winnerFor,
  type FacilityRule,
  type WeatherRule,
} from "./auto-rules";

const NOW = Date.parse("2026-11-14T20:00:00Z"); // 2:00 PM in Madison (CST, UTC-6)

describe("Madison time helpers", () => {
  it("finds local midnight in standard and daylight time", () => {
    expect(new Date(chicagoMidnight("2026-11-16")).toISOString()).toBe("2026-11-16T06:00:00.000Z"); // CST
    expect(new Date(chicagoMidnight("2026-07-04")).toISOString()).toBe("2026-07-04T05:00:00.000Z"); // CDT
  });
  it("reads the rec feed's zone-less local timestamps", () => {
    expect(new Date(parseChicagoLocal("2026-11-14T16:10:46.63")).toISOString()).toBe("2026-11-14T22:10:46.630Z");
  });
});

describe("weather rules", () => {
  const rule: WeatherRule = { kind: "weather", metric: "temp_max_f", date: "2026-11-16", op: ">=", threshold: 40 };
  it("resolves Yes when the rule holds and No otherwise", () => {
    expect(winnerFor(rule, 40)).toBe(0);
    expect(winnerFor(rule, 39.9)).toBe(1);
  });
  it("closes trading at the start of the day and settles the next morning", () => {
    expect(new Date(latestClose(rule)).toISOString()).toBe("2026-11-16T06:00:00.000Z");
    expect(new Date(resolvableAt(rule)).toISOString()).toBe("2026-11-17T12:00:00.000Z"); // 6:00 AM Nov 17
  });
  it("validates", () => {
    expect(validateRule({ kind: "weather", metric: "snow_in", date: "2026-11-20", op: ">", threshold: 1 }, NOW)).toEqual({
      rule: { kind: "weather", metric: "snow_in", date: "2026-11-20", op: ">", threshold: 1 },
    });
    expect(validateRule({ ...rule, date: "2026-11-14" }, NOW)).toHaveProperty("error"); // today has started
    expect(validateRule({ ...rule, date: "2027-01-30" }, NOW)).toHaveProperty("error"); // past forecast range
    expect(validateRule({ ...rule, metric: "humidity" }, NOW)).toHaveProperty("error");
  });
  it("writes a readable question", () => {
    expect(suggestQuestion(rule)).toBe("Will Madison's high temperature on Mon, Nov 16 be at least 40°F?");
  });
});

describe("facility rules", () => {
  const rule: FacilityRule = {
    kind: "facility", location_id: 5761, location_name: "Nick Level 3 Fitness",
    at: "2026-11-16T00:00:00.000Z", op: ">=", threshold: 50, unit: "count",
  };
  const at = Date.parse(rule.at);
  const r = (minutesFromAt: number, count: number, closed = false) => ({
    last_count: count, capacity: 200, is_closed: closed,
    source_updated_at: new Date(at + minutesFromAt * 60e3).toISOString(),
  });

  it("uses the count update closest to the check time within 45 minutes", () => {
    expect(pickReading([r(-40, 10), r(5, 60), r(-20, 30)], at)?.last_count).toBe(60);
    expect(pickReading([r(-50, 10), r(46, 60)], at)).toBeNull();
    expect(pickReading([r(0, 99, true)], at)).toBeNull(); // closed rooms don't settle a market
  });
  it("compares counts or percent of capacity", () => {
    expect(winnerFor(rule, readingValue(rule, r(0, 50)))).toBe(0);
    const pct: FacilityRule = { ...rule, unit: "percent", threshold: 30 };
    expect(readingValue(pct, r(0, 50))).toBe(25);
    expect(winnerFor(pct, readingValue(pct, r(0, 50)))).toBe(1);
  });
  it("closes trading at the check time and settles 45 minutes after", () => {
    expect(latestClose(rule)).toBe(at);
    expect(resolvableAt(rule)).toBe(at + 45 * 60e3);
  });
  it("validates", () => {
    expect(validateRule({ ...rule, at: "2026-11-14T20:05:00Z" }, NOW)).toHaveProperty("error"); // too soon
    expect(validateRule({ ...rule, unit: "percent", threshold: 120 }, NOW)).toHaveProperty("error");
    expect(validateRule(rule, NOW)).toEqual({ rule });
  });
  it("writes a readable question", () => {
    expect(suggestQuestion(rule)).toBe("Will Nick Level 3 Fitness have at least 50 people at Sun, Nov 15, 6:00 PM?");
  });
});
