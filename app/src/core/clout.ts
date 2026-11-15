// Clout rules. Mirror of databricks/lib/clout.py.

export const STARTING_CLOUT = 100; // every account starts here

export const TIERS = [
  { min: 250, privilege: "propose" },
  { min: 500, privilege: "resolve" },
  { min: 1000, privilege: "moderate" },
] as const;

/** Betting spends Clout immediately; you can bet any amount up to your balance. */
export const canAfford = (balance: number, amount: number) => amount > 0 && amount <= balance + 1e-9;

export function privileges(clout: number): string[] {
  const out = ["trade", "comment"];
  for (const t of TIERS) if (clout >= t.min) out.push(t.privilege);
  return out;
}

/**
 * Smart Money line: stakes weighted by each user's realized profit, profitable users only.
 * stakes: [weight, outcomeIndex, cloutStaked], weight = realized profit. Returns null if nobody profitable staked.
 */
export function smartMoney(
  stakes: readonly (readonly [number, number, number])[],
  nOutcomes: number,
): number[] | null {
  const w = new Array<number>(nOutcomes).fill(0);
  for (const [userClout, outcome, staked] of stakes) {
    if (userClout > 0 && staked > 0) w[outcome] += userClout * staked;
  }
  const total = w.reduce((a, x) => a + x, 0);
  return total > 0 ? w.map((x) => x / total) : null;
}

/** Average-cost basis removed when selling `shares` of a position that cost `basis` in total. */
export const sellBasis = (basis: number, position: number, shares: number) =>
  position <= 0 || shares <= 0 ? 0 : (basis * Math.min(shares, position)) / position;

/** trades: [outcomeIndex, cloutSpent, shares]. Net = winning shares - total spent. */
export function netCloutChange(trades: readonly (readonly [number, number, number])[], winner: number): number {
  let won = 0;
  let spent = 0;
  for (const [outcome, amount, shares] of trades) {
    spent += amount;
    if (outcome === winner) won += shares;
  }
  return won - spent;
}

export type Winner = number | "void";

/**
 * Balance credit per user when a market settles. trades: [userId, outcomeIndex, cloutSpent, shares], signed (sells
 * negative). Payout = net winning shares held; void = net Clout put in (negative if they sold at a profit).
 * Mirror of databricks/lib/union.py credits.
 */
export function settlementCredits(trades: readonly (readonly [string, number, number, number])[], winner: Winner): Map<string, number> {
  const byUser = new Map<string, [number, number, number][]>();
  for (const [u, o, spent, shares] of trades) byUser.set(u, [...(byUser.get(u) ?? []), [o, spent, shares]]);
  const out = new Map<string, number>();
  for (const [u, ts] of byUser) {
    const spent = ts.reduce((a, [, s]) => a + s, 0);
    const credit = winner === "void" ? spent : netCloutChange(ts, winner) + spent;
    if (Math.abs(credit) > 1e-9) out.set(u, credit);
  }
  return out;
}

/** Overriding a resolution: each user's balance moves by (new credit - old credit). */
export function overrideDeltas(trades: readonly (readonly [string, number, number, number])[], from: Winner, to: Winner): Map<string, number> {
  const before = settlementCredits(trades, from);
  const after = settlementCredits(trades, to);
  const out = new Map<string, number>();
  for (const u of new Set([...before.keys(), ...after.keys()])) {
    const d = (after.get(u) ?? 0) - (before.get(u) ?? 0);
    if (Math.abs(d) > 1e-9) out.set(u, d);
  }
  return out;
}

