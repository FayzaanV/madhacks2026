import "server-only";
import { applyTrade, prices } from "@/core/lmsr";
import { canAfford } from "@/core/clout";
import { q, tx } from "./ledger";
import { querySql } from "./warehouse";

export type Outcome = { outcome_index: number; label: string; q_shares: number; price: number };
export type Market = {
  market_id: string;
  course: string;
  question: string;
  market_type: string;
  status: string;
  liquidity_b: number;
  resolution_source: string | null;
  closes_at: string;
  is_simulated: boolean;
  n_trades: number;
  volume: number;
  outcomes: Outcome[];
};

function withPrices<T extends { liquidity_b: number; outcomes: Omit<Outcome, "price">[] }>(m: T) {
  const p = prices(m.outcomes.map((o) => o.q_shares), m.liquidity_b);
  return { ...m, outcomes: m.outcomes.map((o, i) => ({ ...o, price: p[i] })) };
}

const MARKET_SQL = `
  SELECT m.market_id, m.course, m.question, m.market_type, m.status, m.liquidity_b, m.resolution_source,
         m.closes_at, m.is_simulated,
         (SELECT count(*)::int FROM trades t WHERE t.market_id = m.market_id) AS n_trades,
         (SELECT coalesce(sum(clout_spent), 0)::float FROM trades t WHERE t.market_id = m.market_id) AS volume,
         (SELECT json_agg(json_build_object('outcome_index', o.outcome_index, 'label', o.label, 'q_shares', o.q_shares)
                          ORDER BY o.outcome_index) FROM outcomes o WHERE o.market_id = m.market_id) AS outcomes
  FROM markets m`;

/** Live markets from the Lakebase ledger, newest activity first. */
export async function listMarkets(status = "live"): Promise<Market[]> {
  const rows = await q<Market>(`${MARKET_SQL} WHERE m.status = $1 ORDER BY volume DESC`, [status]);
  return rows.map(withPrices);
}

export async function getMarket(id: string): Promise<Market | null> {
  const rows = await q<Market>(`${MARKET_SQL} WHERE m.market_id = $1`, [id]);
  return rows[0] ? withPrices(rows[0]) : null;
}

export type Comment = { comment_id: string; user_id: string; handle: string; clout: number; body: string; created_at: string };
export async function getComments(id: string): Promise<Comment[]> {
  return q<Comment>(
    `SELECT c.comment_id, c.user_id, u.handle, c.body, c.created_at,
            u.clout + coalesce((SELECT sum(t.clout_spent) FROM trades t JOIN markets m2 USING (market_id)
                                WHERE t.user_id = u.user_id AND m2.status NOT IN ('resolved','final','voided')), 0)::float AS clout
     FROM comments c JOIN users u USING (user_id)
     WHERE c.market_id = $1 AND c.deleted_at IS NULL ORDER BY c.created_at DESC LIMIT 30`,
    [id],
  );
}

export async function userStake(userId: string, marketId: string): Promise<number> {
  const r = await q<{ s: number }>(
    "SELECT coalesce(sum(clout_spent), 0)::float AS s FROM trades WHERE user_id = $1 AND market_id = $2",
    [userId, marketId],
  );
  return r[0]?.s ?? 0;
}

/** Price + Smart Money history computed by the gold pipeline (Databricks SQL warehouse). */
export type HistoryPoint = { created_at: string; outcome_index: number; crowd_price: number; smart_price: number | null };
export async function priceHistory(id: string): Promise<HistoryPoint[]> {
  return querySql<HistoryPoint>(
    `SELECT created_at, outcome_index, crowd_price, smart_price FROM {catalog}.gold.market_price_history
     WHERE market_id = :id ORDER BY created_at`,
    { id },
  );
}

export type SmartMoney = { outcome_index: number; label: string; crowd_price: number; smart_price: number | null };
export async function smartMoney(id: string): Promise<SmartMoney[]> {
  return querySql<SmartMoney>(
    `SELECT outcome_index, label, crowd_price, smart_price FROM {catalog}.gold.market_smart_money
     WHERE market_id = :id ORDER BY outcome_index`,
    { id },
  );
}

export class TradeError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/**
 * Place a bet: one Postgres transaction that locks the user's balance and the market's outcomes, runs the
 * shared LMSR math, spends the Clout (balance cap: you can't bet more than you have), and records the trade.
 * Winning shares pay 1 Clout each when the market resolves.
 */
export async function placeTrade(userId: string, marketId: string, outcomeIndex: number, amount: number) {
  if (!(amount > 0) || !Number.isFinite(amount)) throw new TradeError("Bet must be a positive amount of Clout.");
  amount = Math.round(amount * 100) / 100;
  return tx(async (c) => {
    const m = (await c.query("SELECT status, liquidity_b FROM markets WHERE market_id = $1", [marketId])).rows[0];
    if (!m) throw new TradeError("Market not found.", 404);
    if (m.status !== "live") throw new TradeError("This market is not open for trading.");
    const u = (await c.query("SELECT clout FROM users WHERE user_id = $1 FOR UPDATE", [userId])).rows[0];
    if (!canAfford(u.clout, amount))
      throw new TradeError(`You only have ${Math.max(0, u.clout).toFixed(1)} Clout available.`);
    const os = (
      await c.query("SELECT outcome_index, q_shares FROM outcomes WHERE market_id = $1 ORDER BY outcome_index FOR UPDATE", [
        marketId,
      ])
    ).rows as { outcome_index: number; q_shares: number }[];
    if (!os[outcomeIndex]) throw new TradeError("Unknown outcome.");
    const q0 = os.map((o) => o.q_shares);
    const before = prices(q0, m.liquidity_b)[outcomeIndex];
    const { newQ, shares, postPrice } = applyTrade(q0, outcomeIndex, amount, m.liquidity_b);
    await c.query("UPDATE outcomes SET q_shares = $3 WHERE market_id = $1 AND outcome_index = $2", [
      marketId,
      outcomeIndex,
      newQ[outcomeIndex],
    ]);
    const balance = (await c.query("UPDATE users SET clout = clout - $2 WHERE user_id = $1 RETURNING clout", [userId, amount]))
      .rows[0].clout as number;
    const tradeId = `t-${crypto.randomUUID()}`;
    await c.query(
      `INSERT INTO trades (trade_id, market_id, user_id, outcome_index, clout_spent, shares, price_before, post_price,
                           prices_after, user_clout_at_trade)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [tradeId, marketId, userId, outcomeIndex, amount, shares, before, postPrice, prices(newQ, m.liquidity_b), u.clout],
    );
    return { tradeId, shares, priceBefore: before, priceAfter: postPrice, balance };
  });
}

export async function addComment(userId: string, marketId: string, body: string) {
  const text = body.trim().slice(0, 500);
  if (!text) throw new TradeError("Comment is empty.");
  const exists = await q("SELECT 1 FROM markets WHERE market_id = $1", [marketId]);
  if (!exists.length) throw new TradeError("Market not found.", 404);
  const commentId = `c-${crypto.randomUUID()}`;
  await q("INSERT INTO comments (comment_id, market_id, user_id, body) VALUES ($1,$2,$3,$4)", [commentId, marketId, userId, text]);
  return { commentId };
}

/** Soft-delete your own comment. */
export async function deleteComment(userId: string, commentId: string) {
  const rows = await q<{ user_id: string }>("SELECT user_id FROM comments WHERE comment_id = $1 AND deleted_at IS NULL", [commentId]);
  if (!rows[0]) throw new TradeError("Comment not found.", 404);
  if (rows[0].user_id !== userId) throw new TradeError("You can only delete your own comments.", 403);
  await q("UPDATE comments SET deleted_at = now() WHERE comment_id = $1", [commentId]);
}
