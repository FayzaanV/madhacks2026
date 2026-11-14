// Clout rules. Mirror of databricks/lib/clout.py.

export const MIN_BET = 10;
export const MAX_BET_FRACTION = 0.1;

export const TIERS = [
  { min: 250, privilege: "propose" },
  { min: 500, privilege: "resolve" },
  { min: 1000, privilege: "moderate" },
] as const;

/** Max total stake per market = max(10, 0.1 * clout). Always at least 10. */
export const maxBet = (clout: number) => Math.max(MIN_BET, MAX_BET_FRACTION * clout);

export const remainingBet = (clout: number, alreadyStaked: number) =>
  Math.max(0, maxBet(clout) - alreadyStaked);

export function privileges(clout: number): string[] {
  const out = ["trade", "comment"];
  for (const t of TIERS) if (clout >= t.min) out.push(t.privilege);
  return out;
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
