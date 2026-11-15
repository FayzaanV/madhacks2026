// Simulated trading agents for simulated markets (is_simulated). Rule-based, no LLM: each trade a simulated user
// makes is decided here from the market's prices, recent moves, a hidden "true" probability that drifts over time,
// and the user's archetype. The runner (server/agents.ts) executes decisions through the normal placeBuy/placeSell.

export type Style = "sharp" | "noise" | "herd" | "contrarian" | "chaos";
export type Decision =
  | { kind: "buy"; outcome: number; clout: number; whale?: boolean }
  | { kind: "sell"; outcome: number; clout: number | "all" }
  | { kind: "skip"; reason: string };

/** Simulated users' archetypes (from databricks/lib/simulate.py) → trading style. */
export const STYLE_OF: Record<string, Style> = { good: "sharp", casual: "noise", herd: "herd", bad: "contrarian", troll: "chaos" };

const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
};
/** Deterministic value in [0, 1) for a key. */
const unit = (...key: (string | number)[]) => fnv(key.join("|")) / 2 ** 32;

/** Seeded PRNG (mulberry32), so agent behavior is reproducible in tests. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOUR = 3600e3;
const SHOCK_EVERY = 2 * HOUR;

/** Log-odds drift of one outcome: three slow waves plus decaying "news shocks" at hashed times. */
function drift(id: string, i: number, t: number): number {
  const waves = [
    [3 * HOUR, 0.6],
    [11 * HOUR, 0.9],
    [37 * HOUR, 0.7],
  ].reduce((a, [period, amp], k) => a + amp * Math.sin((2 * Math.PI * t) / period + 2 * Math.PI * unit(id, i, "phase", k)), 0);
  let shock = 0;
  const now = Math.floor(t / SHOCK_EVERY);
  for (let b = now - 6; b <= now; b++) {
    if (unit(id, i, "shock?", b) < 0.3) {
      const size = (unit(id, i, "size", b) < 0.5 ? -1 : 1) * (0.6 + 1.2 * unit(id, i, "mag", b));
      shock += size * Math.exp(-(t - b * SHOCK_EVERY) / (6 * HOUR));
    }
  }
  return waves + shock + 1.2 * (unit(id, i, "base") - 0.5);
}

/** Hidden "true" probabilities of a market at time t (sums to 1). Agents trade toward it, so odds trend and jump. */
export function belief(marketId: string, n: number, t: number): number[] {
  const logits = Array.from({ length: n }, (_, i) => (n === 2 && i === 1 ? 0 : drift(marketId, i, t)));
  const m = Math.max(...logits);
  const e = logits.map((x) => Math.exp(x - m));
  const s = e.reduce((a, x) => a + x, 0);
  return e.map((x) => Math.min(0.995, Math.max(0.005, x / s)));
}

export type Ctx = {
  prices: number[]; // current crowd prices
  belief: number[]; // hidden true odds
  recent: number[][]; // price vectors after the last ~10 trades, oldest first
  held: number[]; // shares held per outcome
  basis: number[]; // cost basis held per outcome
  worth: number[]; // Clout the whole position per outcome would fetch now
  balance: number; // Clout available
  rand: () => number;
};

const argmax = (xs: number[]) => xs.reduce((b, x, i) => (x > xs[b] ? i : b), 0);
const argmin = (xs: number[]) => xs.reduce((b, x, i) => (x < xs[b] ? i : b), 0);
const between = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

/** Price change per outcome over the recent window. */
export function momentum(recent: number[][], n: number): number[] {
  if (recent.length < 2) return Array(n).fill(0);
  return Array.from({ length: n }, (_, i) => (recent.at(-1)![i] ?? 0) - (recent[0][i] ?? 0));
}

/** Sell decision for a holder: take profit / cut losses with "all", otherwise trim part of the position. */
export function decideSell(ctx: Ctx): Decision | null {
  const held = ctx.held.map((h, i) => [h, i] as const).filter(([h]) => h > 0.01);
  if (!held.length) return null;
  const [, i] = held[Math.floor(ctx.rand() * held.length)];
  const worth = ctx.worth[i];
  const pnl = worth - ctx.basis[i];
  if (pnl > 0.2 * ctx.basis[i] || pnl < -0.5 * ctx.basis[i] || worth < 2) return { kind: "sell", outcome: i, clout: "all" };
  const clout = Math.floor(worth * (0.2 + 0.4 * ctx.rand()));
  return clout >= 1 ? { kind: "sell", outcome: i, clout } : { kind: "sell", outcome: i, clout: "all" };
}

/** What one agent does now. Whale bets (3%) and sells (25% for holders) cut across styles. */
export function decide(style: Style, ctx: Ctx): Decision {
  const n = ctx.prices.length;
  const r = ctx.rand;
  if (ctx.held.some((h) => h > 0.01) && r() < 0.25) {
    const s = decideSell(ctx);
    if (s) return s;
  }
  let buy: Decision;
  const whale = r() < 0.03;
  const edge = ctx.belief.map((b, i) => b - ctx.prices[i]);
  const mom = momentum(ctx.recent, n);
  switch (style) {
    case "sharp": {
      const i = argmax(edge);
      if (edge[i] < 0.03 && !whale) return { kind: "skip", reason: "no edge" };
      buy = { kind: "buy", outcome: i, clout: Math.max(1, Math.min(40, Math.round(5 + edge[i] * 100))) };
      break;
    }
    case "herd": {
      const i = Math.max(...mom) > 0.005 ? argmax(mom) : Math.floor(r() * n);
      buy = { kind: "buy", outcome: i, clout: between(r, 3, 12) };
      break;
    }
    case "contrarian": {
      const i = Math.min(...mom) < -0.005 ? argmin(mom) : Math.floor(r() * n);
      buy = { kind: "buy", outcome: i, clout: between(r, 3, 12) };
      break;
    }
    case "chaos": {
      // Push the favorite toward 100%, or pile into the longest shot: drives prices to the edges.
      const i = r() < 0.6 ? argmax(ctx.prices) : argmin(ctx.prices);
      buy = { kind: "buy", outcome: i, clout: between(r, 15, 40) };
      break;
    }
    default:
      buy = { kind: "buy", outcome: Math.floor(r() * n), clout: between(r, 1, 8) };
  }
  if (buy.kind !== "buy") return buy;
  const clout = whale ? between(r, 40, 150) : buy.clout;
  const affordable = Math.min(clout, Math.floor(ctx.balance));
  if (affordable < 1) return { kind: "skip", reason: "broke" };
  return { kind: "buy", outcome: buy.outcome, clout: affordable, ...(whale ? { whale: true } : {}) };
}

/** Number of trades this minute: Poisson(rate), capped. */
export function poisson(rate: number, r: () => number, cap = 20): number {
  const l = Math.exp(-rate);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= r();
  } while (p > l && k <= cap);
  return Math.min(cap, k - 1);
}
