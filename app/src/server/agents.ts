import "server-only";
import { belief, decide, poisson, STYLE_OF, type Ctx } from "@/core/agents";
import { prices, sellProceeds } from "@/core/lmsr";
import { q } from "./ledger";
import { placeBuy, placeSell, TradeError } from "./markets";

/**
 * Simulated trading agents: every minute (background poller, or the page-view tick as a backup) simulated users
 * trade on simulated markets only (is_simulated), so their odds keep moving and edge cases (whales, sells,
 * extreme prices, broke traders, closing rushes) happen on their own. Real markets are never touched.
 * Rule-based (core/agents.ts), no LLM. SIM_AGENTS=0 turns them off; SIM_TRADES_PER_MIN sets the pace (default 6).
 */

const RATE = Math.max(0, Math.min(20, Number(process.env.SIM_TRADES_PER_MIN ?? 6) || 0));
export const agentsEnabled = () => process.env.SIM_AGENTS !== "0" && RATE > 0;

type SimMarket = { market_id: string; liquidity_b: number; q: number[]; closes_at: string; recent: number[][] | null };

export async function agentTick() {
  if (!agentsEnabled()) return { off: true };
  const r = Math.random;
  const n = poisson(RATE, r);
  if (!n) return { trades: 0 };
  const markets = await q<SimMarket>(
    `SELECT m.market_id, m.liquidity_b, m.closes_at,
            (SELECT array_agg(o.q_shares ORDER BY o.outcome_index) FROM outcomes o WHERE o.market_id = m.market_id) AS q,
            (SELECT array_agg(p ORDER BY created_at) FROM (
               SELECT to_json(t.prices_after) AS p, t.created_at FROM trades t
               WHERE t.market_id = m.market_id ORDER BY t.created_at DESC LIMIT 10) x) AS recent
     FROM markets m
     WHERE m.is_simulated AND m.status = 'live' AND m.closes_at > now() + interval '1 minute'`,
  );
  if (!markets.length) return { trades: 0, note: "no open simulated markets" };
  const users = await q<{ user_id: string; archetype: string | null; clout: number }>(
    "SELECT user_id, archetype, clout FROM users WHERE is_simulated AND deleted_at IS NULL AND clout >= 1 ORDER BY random() LIMIT $1",
    [n],
  );
  // Markets in their last 15 minutes get 3x the attention (closing rush).
  const weight = (m: SimMarket) => (Date.parse(m.closes_at) - Date.now() < 15 * 60e3 ? 3 : 1);
  const total = markets.reduce((a, m) => a + weight(m), 0);
  const pick = () => {
    let x = r() * total;
    for (const m of markets) if ((x -= weight(m)) < 0) return m;
    return markets[markets.length - 1];
  };

  const out = { trades: 0, buys: 0, sells: 0, whales: 0, skipped: 0 };
  for (const u of users) {
    const m = pick();
    const p = prices(m.q, m.liquidity_b);
    const pos = await q<{ outcome_index: number; shares: number; basis: number }>(
      `SELECT outcome_index, sum(shares)::float AS shares, sum(basis_change)::float AS basis FROM trades
       WHERE user_id = $1 AND market_id = $2 GROUP BY outcome_index`,
      [u.user_id, m.market_id],
    );
    const held = p.map((_, i) => Math.max(0, pos.find((x) => x.outcome_index === i)?.shares ?? 0));
    const ctx: Ctx = {
      prices: p,
      belief: belief(m.market_id, p.length, Date.now()),
      recent: (m.recent ?? []).filter((v): v is number[] => Array.isArray(v) && v.length === p.length),
      held,
      basis: p.map((_, i) => pos.find((x) => x.outcome_index === i)?.basis ?? 0),
      worth: held.map((h, i) => (h > 0 ? sellProceeds(m.q, i, h, m.liquidity_b) : 0)),
      balance: u.clout,
      rand: r,
    };
    const d = decide(STYLE_OF[u.archetype ?? ""] ?? "noise", ctx);
    try {
      if (d.kind === "buy") {
        await placeBuy(u.user_id, m.market_id, d.outcome, d.clout);
        out.buys++;
        if (d.whale) out.whales++;
      } else if (d.kind === "sell") {
        await placeSell(u.user_id, m.market_id, d.outcome, d.clout);
        out.sells++;
      } else {
        out.skipped++;
        continue;
      }
      out.trades++;
      // Keep this tick's later decisions on current prices.
      const [fresh] = await q<{ q: number[] }>(
        "SELECT array_agg(q_shares ORDER BY outcome_index) AS q FROM outcomes WHERE market_id = $1",
        [m.market_id],
      );
      if (fresh) m.q = fresh.q;
    } catch (e) {
      if (!(e instanceof TradeError)) throw e; // closed, rate-limited, worth < asked: skip like a person would
      out.skipped++;
    }
  }
  return out;
}

/** Agent trades in the last hour (admin tools line). */
export async function agentActivity(): Promise<number> {
  const [r] = await q<{ n: number }>(
    `SELECT count(*)::int AS n FROM trades t JOIN users u USING (user_id) JOIN markets m USING (market_id)
     WHERE u.is_simulated AND m.is_simulated AND t.created_at > now() - interval '1 hour'`,
  );
  return r?.n ?? 0;
}
