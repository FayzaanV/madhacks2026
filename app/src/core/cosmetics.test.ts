import { describe, expect, it } from "vitest";
import { activeLook, equip, ITEMS, itemById, nextUnlock, owns, parseEquipped, progress } from "./cosmetics";

const gold = itemById("hat-crown-gold")!;
const dunce = itemById("hat-dunce")!;

describe("ownership follows Clout", () => {
  it("owns an item at or above its threshold only", () => {
    expect(owns(gold, 999)).toBe(false);
    expect(owns(gold, 1000)).toBe(true);
  });
  it("Hall of Shame items are owned at or below their max", () => {
    expect(owns(dunce, 50)).toBe(true);
    expect(owns(dunce, -20)).toBe(true);
    expect(owns(dunce, 51)).toBe(false);
  });
  it("every item has exactly one of min or max and a unique id", () => {
    for (const i of ITEMS) expect((i.min === undefined) !== (i.max === undefined)).toBe(true);
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
  });
});

describe("equipping", () => {
  it("equips owned items and refuses locked ones", () => {
    const eq = equip(null, "hat", "hat-party", 120);
    expect(eq).toEqual({ hat: "hat-party" });
    expect(() => equip(JSON.stringify(eq), "hat", "hat-crown-gold", 120)).toThrow(/1000 Clout/);
    expect(() => equip(null, "frame", "hat-party", 500)).toThrow(/Unknown item/);
  });
  it("clears a slot with null", () => {
    expect(equip(JSON.stringify({ hat: "hat-party", color: "color-badger" }), "hat", null, 200)).toEqual({ color: "color-badger" });
  });
});

describe("losing and regaining items", () => {
  const saved = JSON.stringify({ hat: "hat-wizard", frame: "frame-gold", color: "color-badger" });
  it("hides items you drop below and shows them again when you climb back", () => {
    expect(activeLook(saved, 320)).toEqual({ hat: "hat-wizard", frame: "frame-gold", color: "color-badger" });
    expect(activeLook(saved, 150)).toEqual({ color: "color-badger" }); // wizard (300) + gold ring (300) hidden
    expect(activeLook(saved, 90)).toEqual({});
    expect(activeLook(saved, 300)).toEqual({ hat: "hat-wizard", frame: "frame-gold", color: "color-badger" }); // regained
  });
  it("ignores malformed or unknown saved data", () => {
    expect(parseEquipped("not json")).toEqual({});
    expect(parseEquipped(JSON.stringify({ hat: "frame-gold", color: "nope" }))).toEqual({});
  });
});

describe("progress hints", () => {
  it("shows progress toward the next unlock", () => {
    expect(progress(gold, 500)).toBe(0.5);
    expect(progress(gold, 1200)).toBe(1);
    expect(nextUnlock(100)?.min).toBe(110);
    expect(nextUnlock(5000)).toBeNull();
  });
});
