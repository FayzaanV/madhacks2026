import "server-only";
import { prices } from "@/core/lmsr";
import { closeTimes, pickTemplates, weightedPick } from "@/core/testmarkets";
import { triggerRefresh } from "./jobs";
import { q, tx } from "./ledger";
import { isAdmin, placeBuy, settleMarket, TradeError } from "./markets";

/**
 * Test markets: [Test] markets (course 'Test', is_simulated) that close tonight, get simulated trading from the
 * simulated users, and auto-resolve at random (weighted by the crowd's odds) once closed. Admins can still resolve
 * early or override afterwards. Everything lives in the shared production ledger, so everyone sees the same data.
 */

const TEST_COURSE = "Test";
const rand = () => Math.random();
const randInt = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

/** A few simulated users with enough Clout to bet. */
async function simTraders(n: number) {
  return q<{ user_id: string }>(
    "SELECT user_id FROM users WHERE is_simulated AND deleted_at IS NULL AND clout >= 20 ORDER BY random() LIMIT $1",
    [n],
  );
}

/** One simulated bet: a sim user leans toward the market's hidden "true" odds. */
async function simBet(userId: string, marketId: string, lean: number[]) {
  const outcome = weightedPick(lean, rand());
  try {
    await placeBuy(userId, marketId, outcome, randInt(1, 15));
  } catch (e) {
    if (!(e instanceof TradeError)) throw e; // closed, broke, rate-limited: just skip
  }
}

/** Random "true" odds a market drifts toward, so simulated prices move somewhere instead of staying flat. */
function hiddenLean(n: number): number[] {
  if (n === 2) {
    const p = 0.2 + rand() * 0.6;
    return [p, 1 - p];
  }
  const w = Array.from({ length: n }, () => 0.2 + rand());
  const s = w.reduce((a, x) => a + x, 0);
  return w.map((x) => x / s);
}

/** Create `count` test markets closing tonight, each seeded with 12-25 simulated bets. Admins only. */
export async function createTestMarkets(admin: { user_id: string; email: string; school_id: string }, count: number) {
  if (!isAdmin(admin)) throw new TradeError("Only admins can create test markets.", 403);
  const n = Math.max(1, Math.min(12, Math.floor(count) || 8));
  const templates = pickTemplates(n, rand);
  const closes = closeTimes(new Date(), templates.length);
  const created: { marketId: string; question: string; closes_at: string }[] = [];
  for (const [i, t] of templates.entries()) {
    const labels = t.outcomes ?? ["Yes", "No"];
    const marketId = `m-test-${crypto.randomUUID()}`;
    const question = `[Test] ${t.question}`;
    await tx(async (c) => {
      await c.query(
        `INSERT INTO markets (market_id, school_id, course, question, market_type, status, liquidity_b, creator_id,
                              resolution_source, is_simulated, opens_at, closes_at)
         VALUES ($1, $2, $3, $4, $5, 'live', 200, $6, 'Random draw weighted by the odds at close (test market)', true, now(), $7)`,
        [marketId, admin.school_id, TEST_COURSE, question, t.outcomes ? "multiple_choice" : "binary", admin.user_id, closes[i]],
      );
      await c.query(
        `INSERT INTO outcomes (market_id, outcome_index, label, q_shares, is_simulated)
         SELECT $1, i - 1, label, 0, true FROM unnest($2::text[]) WITH ORDINALITY AS x(label, i)`,
        [marketId, labels],
      );
    });
    const lean = hiddenLean(labels.length);
    for (const u of await simTraders(randInt(12, 25))) await simBet(u.user_id, marketId, lean);
    created.push({ marketId, question, closes_at: closes[i].toISOString() });
  }
  return { created };
}

/**
 * Resolve every closed, still-live test market at random, weighted by its current odds. One leaderboard refresh
 * for the whole batch. Safe to call concurrently: resolveMarket locks the market and refuses settled ones.
 */
export async function settleDueTestMarkets() {
  const due = await q<{ market_id: string; liquidity_b: number; q: number[]; creator_id: string }>(
    `SELECT m.market_id, m.liquidity_b, m.creator_id, array_agg(o.q_shares ORDER BY o.outcome_index) AS q
     FROM markets m JOIN outcomes o USING (market_id)
     WHERE m.course = $1 AND m.status = 'live' AND m.closes_at <= now()
     GROUP BY m.market_id, m.liquidity_b, m.creator_id`,
    [TEST_COURSE],
  );
  const settled: string[] = [];
  for (const m of due) {
    const winner = weightedPick(prices(m.q, m.liquidity_b), rand());
    try {
      await settleMarket(m.market_id, winner, "Auto-resolved at random, weighted by the odds at close (test market).", m.creator_id, {
        refresh: false,
      });
      settled.push(m.market_id);
    } catch (e) {
      if (!(e instanceof TradeError)) throw e; // someone resolved it first
    }
  }
  if (settled.length) await triggerRefresh();
  return { settled: settled.length };
}

let lastTick = 0;

/**
 * Background activity, at most once a minute per server: settle due test markets, then let the simulated trading
 * agents (server/agents.ts) trade simulated markets so their odds keep moving. Runs from the background poller and
 * from POST /api/sim/tick (page views) as a backup; cheap when there's nothing to do.
 */
export async function simTick() {
  if (Date.now() - lastTick < 60e3) return { skipped: true };
  lastTick = Date.now();
  const { settled } = await settleDueTestMarkets();
  const agents = await (await import("./agents")).agentTick();
  return { settled, agents };
}
