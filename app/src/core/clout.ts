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
