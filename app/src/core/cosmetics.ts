// Shop items: cosmetics you unlock with Clout. Nothing is bought or spent; holding enough true Clout (balance + Clout
// in open bets) is what owns an item. Ownership is never stored: it's worked out from your Clout every time, so
// dropping below an item's threshold hides it and climbing back above shows it again automatically.
// What IS stored is your choice per slot (users.cosmetics, JSON), so a regained item comes back equipped.

export type Slot = "hat" | "frame" | "color";

export type Item = {
  id: string;
  slot: Slot;
  name: string;
  blurb: string;
  min?: number; // owned at true Clout >= min
  max?: number; // owned at true Clout <= max (Hall of Shame items)
};

export const SLOTS: { slot: Slot; label: string; hint: string }[] = [
  { slot: "hat", label: "Headwear", hint: "Sits on your profile picture" },
  { slot: "frame", label: "Frames", hint: "A border around your profile picture" },
  { slot: "color", label: "Name colors", hint: "Changes the color of your @username" },
];

export const ITEMS: Item[] = [
  // Headwear
  { id: "hat-party", slot: "hat", name: "Party Hat", blurb: "You made your first good call.", min: 110 },
  { id: "hat-beanie", slot: "hat", name: "Badger Beanie", blurb: "Cardinal red, for the regulars.", min: 150 },
  { id: "hat-grad", slot: "hat", name: "Graduation Cap", blurb: "You've studied the market.", min: 200 },
  { id: "hat-wizard", slot: "hat", name: "Wizard Hat", blurb: "Forecasting looks like magic.", min: 300 },
  { id: "hat-crown-silver", slot: "hat", name: "Silver Crown", blurb: "Campus royalty, almost.", min: 500 },
  { id: "hat-crown-gold", slot: "hat", name: "Golden Crown", blurb: "The top of the curve.", min: 1000 },
  { id: "hat-dunce", slot: "hat", name: "Dunce Cap", blurb: "Hall of Shame exclusive. Wear it with pride.", max: 50 },
  // Frames
  { id: "frame-silver", slot: "frame", name: "Silver Ring", blurb: "A clean silver border.", min: 125 },
  { id: "frame-neon", slot: "frame", name: "Neon Pulse", blurb: "A glowing violet border that pulses.", min: 200 },
  { id: "frame-gold", slot: "frame", name: "Gold Ring", blurb: "Polished gold.", min: 300 },
  { id: "frame-aurora", slot: "frame", name: "Aurora", blurb: "A border that slowly cycles through color.", min: 500 },
  { id: "frame-diamond", slot: "frame", name: "Diamond", blurb: "Ice-blue and sparkling.", min: 1000 },
  // Name colors
  { id: "color-badger", slot: "color", name: "Badger Red", blurb: "Your name in cardinal red.", min: 110 },
  { id: "color-mendota", slot: "color", name: "Lake Mendota", blurb: "Deep lake blue.", min: 125 },
  { id: "color-terrace", slot: "color", name: "Terrace Sunburst", blurb: "Union Terrace chair orange.", min: 150 },
  { id: "color-sunset", slot: "color", name: "Sunset", blurb: "An orange-to-pink gradient.", min: 250 },
  { id: "color-aurora", slot: "color", name: "Aurora", blurb: "A shimmering, moving gradient.", min: 500 },
  { id: "color-rainbow", slot: "color", name: "Rainbow", blurb: "Every color, always moving.", min: 1000 },
];

const BY_ID = new Map(ITEMS.map((i) => [i.id, i]));
export const itemById = (id: string) => BY_ID.get(id);

export function owns(item: Item, clout: number): boolean {
  if (item.max !== undefined) return clout <= item.max;
  return clout >= (item.min ?? 0);
}

/** "Unlocks at 300 Clout" / "Only at 50 Clout or less". */
export const requirement = (item: Item) =>
  item.max !== undefined ? `Only at ${item.max} Clout or less` : `Unlocks at ${item.min} Clout`;

/** 0..1 progress toward an item (1 = owned). Hall of Shame items show 0 until owned. */
export function progress(item: Item, clout: number): number {
  if (owns(item, clout)) return 1;
  if (item.max !== undefined || !item.min) return 0;
  return Math.max(0, Math.min(1, clout / item.min));
}

export type Equipped = Partial<Record<Slot, string>>;
export type Look = Partial<Record<Slot, string>>;

/** Parse users.cosmetics; anything malformed or unknown is dropped. */
export function parseEquipped(raw: string | null | undefined): Equipped {
  if (!raw) return {};
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const out: Equipped = {};
    for (const { slot } of SLOTS) {
      const id = j[slot];
      if (typeof id === "string" && itemById(id)?.slot === slot) out[slot] = id;
    }
    return out;
  } catch {
    return {};
  }
}

/** What shows right now: equipped items you still own at this Clout. Items below threshold just don't show. */
export function activeLook(raw: string | null | undefined, clout: number): Look {
  const eq = parseEquipped(raw);
  const out: Look = {};
  for (const { slot } of SLOTS) {
    const it = eq[slot] ? itemById(eq[slot]!) : undefined;
    if (it && owns(it, clout)) out[slot] = it.id;
  }
  return out;
}

/** Equip (or clear with null) one slot. Throws a readable message if the item isn't yours at this Clout. */
export function equip(raw: string | null | undefined, slot: Slot, id: string | null, clout: number): Equipped {
  const eq = parseEquipped(raw);
  if (!SLOTS.some((s) => s.slot === slot)) throw new Error("Unknown slot.");
  if (id === null) {
    delete eq[slot];
    return eq;
  }
  const it = itemById(id);
  if (!it || it.slot !== slot) throw new Error("Unknown item.");
  if (!owns(it, clout)) throw new Error(`${it.name} isn't yours yet: ${requirement(it)}.`);
  eq[slot] = id;
  return eq;
}

/** The cheapest item you don't own yet (for "next unlock" hints). */
export function nextUnlock(clout: number): Item | null {
  return ITEMS.filter((i) => i.min !== undefined && clout < i.min).sort((a, b) => a.min! - b.min!)[0] ?? null;
}
