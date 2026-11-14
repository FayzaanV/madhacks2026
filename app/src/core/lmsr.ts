// LMSR market maker. Mirror of databricks/lib/clout.py; both tested against lib/test-vectors.json.

export const DEFAULT_B = 500; // a 10-Clout bet moves a 50/50 binary market by ~1 point

/** exps[j] = exp(q_j/b - m) with m = max(q)/b (log-sum-exp, avoids overflow). */
function lse(q: readonly number[], b: number): { m: number; e: number[] } {
  const m = Math.max(...q) / b;
  return { m, e: q.map((x) => Math.exp(x / b - m)) };
}

const sum = (xs: readonly number[]) => xs.reduce((a, x) => a + x, 0);

/** C(q) = b * ln(sum_j exp(q_j / b)) */
export function cost(q: readonly number[], b = DEFAULT_B): number {
  const { m, e } = lse(q, b);
  return b * (m + Math.log(sum(e)));
}

/** Implied probabilities; they sum to 1. */
export function prices(q: readonly number[], b = DEFAULT_B): number[] {
  const { e } = lse(q, b);
  const s = sum(e);
  return e.map((x) => x / s);
}

/** Clout needed to buy `shares` of outcome i. */
export function costToBuy(q: readonly number[], i: number, shares: number, b = DEFAULT_B): number {
  const q2 = [...q];
  q2[i] += shares;
  return cost(q2, b) - cost(q, b);
}

/** Shares of outcome i received for spending `amount` Clout (closed form). */
export function sharesForAmount(q: readonly number[], i: number, amount: number, b = DEFAULT_B): number {
  if (amount <= 0) return 0;
  const { e } = lse(q, b);
  return b * Math.log1p((sum(e) / e[i]) * Math.expm1(amount / b));
}

export function applyTrade(q: readonly number[], i: number, amount: number, b = DEFAULT_B) {
  const shares = sharesForAmount(q, i, amount, b);
  const newQ = [...q];
  newQ[i] += shares;
  return { newQ, shares, postPrice: prices(newQ, b)[i] };
}

/** Clout received for selling `shares` of outcome i back to the market maker: C(q) - C(q - shares*e_i). */
export const sellProceeds = (q: readonly number[], i: number, shares: number, b = DEFAULT_B) =>
  shares <= 0 ? 0 : -costToBuy(q, i, -shares, b);

/**
 * Shares of outcome i to sell to receive exactly `amount` Clout (inverse of sellProceeds, closed form):
 * k = -b * ln(1 - (S/E_i) * (1 - e^(-a/b))). NaN if the market can't pay that much for outcome i.
 */
export function sharesForProceeds(q: readonly number[], i: number, amount: number, b = DEFAULT_B): number {
  if (amount <= 0) return 0;
  const { e } = lse(q, b);
  return -b * Math.log1p(-(sum(e) / e[i]) * -Math.expm1(-amount / b));
}

export function applySell(q: readonly number[], i: number, shares: number, b = DEFAULT_B) {
  const proceeds = sellProceeds(q, i, shares, b);
  const newQ = [...q];
  newQ[i] -= shares;
  return { newQ, proceeds, postPrice: prices(newQ, b)[i] };
}

export const maxMarketMakerLoss = (nOutcomes: number, b = DEFAULT_B) => b * Math.log(nOutcomes);
