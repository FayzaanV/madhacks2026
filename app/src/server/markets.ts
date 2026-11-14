import "server-only";
import type { PoolClient } from "pg";
import { applySell, applyTrade, DEFAULT_B, prices, sellProceeds, sharesForProceeds } from "@/core/lmsr";
import { canAfford, netCloutChange, privileges, sellBasis } from "@/core/clout";
import { triggerRefresh } from "./jobs";
import { openStakeSql, q, tx } from "./ledger";
import { clearWarehouseCache, querySql } from "./warehouse";

const MAX_TRADES_PER_MINUTE = 20;

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
  past_close: boolean; // trading has closed, awaiting resolution
  winning_outcome_index: number | null;
  resolution_note: string | null;
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
         m.closes_at, m.is_simulated, m.closes_at < now() AS past_close,
         r.winning_outcome_index, r.rationale AS resolution_note,
         (SELECT count(*)::int FROM trades t WHERE t.market_id = m.market_id) AS n_trades,
         (SELECT coalesce(sum(abs(clout_spent)), 0)::float FROM trades t WHERE t.market_id = m.market_id) AS volume,
         (SELECT json_agg(json_build_object('outcome_index', o.outcome_index, 'label', o.label, 'q_shares', o.q_shares)
                          ORDER BY o.outcome_index) FROM outcomes o WHERE o.market_id = m.market_id) AS outcomes
  FROM markets m LEFT JOIN resolutions r USING (market_id)`;

/** Live markets from the Lakebase ledger, newest activity first. */
export async function listMarkets(status = "live"): Promise<Market[]> {
  const rows = await q<Market>(`${MARKET_SQL} WHERE m.status = $1 ORDER BY volume DESC`, [status]);
  return rows.map(withPrices);
}

export async function getMarket(id: string): Promise<Market | null> {
  const rows = await q<Market>(`${MARKET_SQL} WHERE m.market_id = $1`, [id]);
  return rows[0] ? withPrices(rows[0]) : null;
}

export type Comment = {
  comment_id: string;
  user_id: string;
  handle: string;
  title: string | null;
  avatar_v: number | null;
  is_simulated: boolean;
  clout: number;
  body: string;
  created_at: string; // ISO with microseconds, so it doubles as a paging cursor
};
export type CommentPage = { comments: Comment[]; next: string | null; total: number };

const COMMENT_PAGE = 50;

/**
 * Comments newest first, 50 per page. `before` is the `next` cursor from the previous page
 * ("<created_at>|<comment_id>"), so older comments are paged in instead of silently dropped.
 */
export async function getComments(id: string, before?: string | null): Promise<CommentPage> {
  const [ts, cid] = before ? before.split("|") : [null, null];
  const [rows, total] = await Promise.all([
    q<Comment>(
      `SELECT c.comment_id, c.user_id, u.handle, u.title, u.is_simulated,
              extract(epoch FROM u.avatar_updated_at)::int AS avatar_v, c.body,
              to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
              u.clout + ${openStakeSql("u.user_id")} AS clout
       FROM comments c JOIN users u USING (user_id)
       WHERE c.market_id = $1 AND c.deleted_at IS NULL
         AND ($2::timestamptz IS NULL OR (c.created_at, c.comment_id) < ($2::timestamptz, $3::text))
       ORDER BY c.created_at DESC, c.comment_id DESC LIMIT ${COMMENT_PAGE + 1}`,
      [id, ts, cid],
    ),
    q<{ n: number }>("SELECT count(*)::int AS n FROM comments WHERE market_id = $1 AND deleted_at IS NULL", [id]),
  ]);
  const page = rows.slice(0, COMMENT_PAGE);
  const last = page.at(-1);
  return {
    comments: page,
    next: rows.length > COMMENT_PAGE && last ? `${last.created_at}|${last.comment_id}` : null,
    total: total[0]?.n ?? page.length,
  };
}

/** Cost basis you still have in this market (what you paid for the shares you hold). */
export async function userStake(userId: string, marketId: string): Promise<number> {
  const r = await q<{ s: number }>(
    "SELECT coalesce(sum(basis_change), 0)::float AS s FROM trades WHERE user_id = $1 AND market_id = $2",
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

type TradeCtx = { c: PoolClient; liquidityB: number; balance: number; q0: number[] };

/**
 * Shared trade transaction: lock the user's balance row then the market's outcomes, and enforce the market
 * status, rate limit and course-staff rules before the buy or sell runs. Rows are always locked in that order.
 */
function trade<T>(userId: string, marketId: string, outcomeIndex: number, fn: (t: TradeCtx) => Promise<T>) {
  return tx(async (c) => {
    // FOR SHARE: trades run in parallel, but wait for (and then see) a resolution holding the row FOR UPDATE,
    // so no trade can land after resolveMarket has read the market's trades. Lock order: market, user, outcomes.
    const m = (
      await c.query("SELECT status, liquidity_b, course, closes_at < now() AS past_close FROM markets WHERE market_id = $1 FOR SHARE", [
        marketId,
      ])
    ).rows[0];
    if (!m) throw new TradeError("Market not found.", 404);
    if (m.status !== "live") throw new TradeError("This market is not open for trading.");
    if (m.past_close) throw new TradeError("Trading has closed; this market is awaiting resolution.");
    const u = (await c.query("SELECT clout FROM users WHERE user_id = $1 FOR UPDATE", [userId])).rows[0];
    // Checked after the user row lock so parallel requests from one user can't slip past the limit.
    const recent = (
      await c.query("SELECT count(*)::int AS n FROM trades WHERE user_id = $1 AND created_at > now() - interval '1 minute'", [userId])
    ).rows[0].n as number;
    if (recent >= MAX_TRADES_PER_MINUTE) throw new TradeError("You're trading too fast. Wait a minute and try again.", 429);
    const staff = await c.query("SELECT 1 FROM course_staff WHERE user_id = $1 AND course = $2", [userId, m.course]);
    if (staff.rowCount) throw new TradeError(`Instructors and TAs can't trade on ${m.course} markets.`, 403);
    const os = (
      await c.query("SELECT outcome_index, q_shares FROM outcomes WHERE market_id = $1 ORDER BY outcome_index FOR UPDATE", [
        marketId,
      ])
    ).rows as { outcome_index: number; q_shares: number }[];
    if (!Number.isInteger(outcomeIndex) || !os[outcomeIndex]) throw new TradeError("Unknown outcome.");
    return fn({ c, liquidityB: m.liquidity_b, balance: u.clout, q0: os.map((o) => o.q_shares) });
  });
}

/** Record one trade row and move the market's outcome shares and the user's balance. Signed: see db/schema.sql. */
async function record(
  t: TradeCtx,
  userId: string,
  marketId: string,
  i: number,
  row: { side: "buy" | "sell"; shares: number; cloutSpent: number; basisChange: number; newQ: number[] },
) {
  const before = prices(t.q0, t.liquidityB)[i];
  const after = prices(row.newQ, t.liquidityB);
  await t.c.query("UPDATE outcomes SET q_shares = $3 WHERE market_id = $1 AND outcome_index = $2", [marketId, i, row.newQ[i]]);
  const balance = (
    await t.c.query("UPDATE users SET clout = clout - $2 WHERE user_id = $1 RETURNING clout", [userId, row.cloutSpent])
  ).rows[0].clout as number;
  const tradeId = `t-${crypto.randomUUID()}`;
  await t.c.query(
    `INSERT INTO trades (trade_id, market_id, user_id, outcome_index, side, clout_spent, shares, basis_change, price_before,
                         post_price, prices_after, user_clout_at_trade)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [tradeId, marketId, userId, i, row.side, row.cloutSpent, row.shares, row.basisChange, before, after[i], after, t.balance],
  );
  return { tradeId, priceBefore: before, priceAfter: after[i], balance };
}

/**
 * Buy: spend a whole number of Clout on outcome i (up to your balance). Each share pays 1 Clout if i wins.
 */
export async function placeBuy(userId: string, marketId: string, outcomeIndex: number, amount: number) {
  if (!Number.isInteger(amount) || amount < 1) throw new TradeError("Bet a whole number of Clout (1 or more).");
  return trade(userId, marketId, outcomeIndex, async (t) => {
    if (!canAfford(t.balance, amount))
      throw new TradeError(`You only have ${Math.max(0, t.balance).toFixed(1)} Clout available.`);
    const { newQ, shares } = applyTrade(t.q0, outcomeIndex, amount, t.liquidityB);
    const r = await record(t, userId, marketId, outcomeIndex, { side: "buy", shares, cloutSpent: amount, basisChange: amount, newQ });
    return { side: "buy" as const, shares, clout: amount, ...r };
  });
}

/**
 * Sell outcome i back to the market maker at the LMSR price, either for a whole number of Clout (`clout`; the
 * shares are solved exactly with sharesForProceeds) or the whole position (`"all"`, the only fractional case).
 * Proceeds go to your balance now; the position's average cost leaves your open stake, so the difference is
 * realized profit or loss.
 */
export async function placeSell(userId: string, marketId: string, outcomeIndex: number, want: number | "all") {
  if (want !== "all" && (!Number.isInteger(want) || want < 1)) throw new TradeError("Sell for a whole number of Clout (1 or more).");
  return trade(userId, marketId, outcomeIndex, async (t) => {
    const pos = (
      await t.c.query(
        `SELECT coalesce(sum(shares), 0)::float AS shares, coalesce(sum(basis_change), 0)::float AS basis
         FROM trades WHERE user_id = $1 AND market_id = $2 AND outcome_index = $3`,
        [userId, marketId, outcomeIndex],
      )
    ).rows[0] as { shares: number; basis: number };
    if (pos.shares <= 1e-9) throw new TradeError("You don't hold any shares of this outcome.");
    let k = pos.shares;
    if (want !== "all") {
      const need = sharesForProceeds(t.q0, outcomeIndex, want, t.liquidityB);
      if (!Number.isFinite(need) || need > pos.shares + 1e-9) {
        const most = Math.floor(sellProceeds(t.q0, outcomeIndex, pos.shares, t.liquidityB) + 1e-9);
        throw new TradeError(
          most >= 1
            ? `Your shares are worth at most ${most} Clout right now. Sell for ${most} or less, or sell all.`
            : "Your shares are worth less than 1 Clout right now. Use Sell all.",
        );
      }
      k = Math.min(need, pos.shares);
    }
    const { newQ, proceeds: raw } = applySell(t.q0, outcomeIndex, k, t.liquidityB);
    const proceeds = want === "all" ? raw : want; // exact by construction; avoid float dust in the ledger
    const removed = sellBasis(pos.basis, pos.shares, k);
    const r = await record(t, userId, marketId, outcomeIndex, {
      side: "sell",
      shares: -k,
      cloutSpent: -proceeds,
      basisChange: -removed,
      newQ,
    });
    return { side: "sell" as const, shares: k, clout: proceeds, realized: proceeds - removed, ...r };
  });
}

/**
 * Resolve a market (or void it). One Postgres transaction that:
 *   - requires the resolve privilege (500+ true Clout = balance + open stake), or an ADMIN_EMAILS account
 *   - locks the market, records the resolution with a 24h dispute deadline, sets status resolved/voided
 *   - pays out: each winning share still held credits 1 Clout (cash already moved when trades were placed);
 *     a voided market reverses every trader's net cash flow (refunds stakes, takes back profit taken by selling)
 * Then kicks off the refresh job so gold (leaderboards, Brier, calibration) catches up within minutes.
 * Disputes are not built yet: a later overturn would need to reverse these credits.
 */
export async function resolveMarket(
  user: { user_id: string; email: string; clout: number; open_stake: number },
  marketId: string,
  winner: number | "void",
  rationale: string,
) {
  if (!canResolve(user)) throw new TradeError("Resolving markets takes 500+ Clout.", 403);
  const note = rationale.trim().slice(0, 1000);
  const out = await tx(async (c) => {
    const m = (await c.query("SELECT status FROM markets WHERE market_id = $1 FOR UPDATE", [marketId])).rows[0];
    if (!m) throw new TradeError("Market not found.", 404);
    if (!["live", "closed"].includes(m.status)) throw new TradeError(`This market is already ${m.status}.`, 409);
    const n = (await c.query("SELECT count(*)::int AS n FROM outcomes WHERE market_id = $1", [marketId])).rows[0].n as number;
    if (winner !== "void" && !(Number.isInteger(winner) && winner >= 0 && winner < n)) throw new TradeError("Unknown outcome.");

    const rows = (
      await c.query("SELECT user_id, outcome_index, clout_spent, shares FROM trades WHERE market_id = $1", [marketId])
    ).rows as { user_id: string; outcome_index: number; clout_spent: number; shares: number }[];
    const byUser = new Map<string, [number, number, number][]>();
    for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), [r.outcome_index, r.clout_spent, r.shares]]);
    // Signed trades (sells are negative): payout = net winning shares held; void = net Clout put in, which is
    // negative if someone sold for more than they paid, so voiding takes that profit back.
    const ids: string[] = [];
    const credits: number[] = [];
    for (const [id, trades] of byUser) {
      const spent = trades.reduce((a, [, s]) => a + s, 0);
      const credit = winner === "void" ? spent : netCloutChange(trades, winner) + spent;
      if (Math.abs(credit) > 1e-9) {
        ids.push(id);
        credits.push(credit);
      }
    }
    await c.query(
      `UPDATE users u SET clout = u.clout + x.credit
       FROM unnest($1::text[], $2::float8[]) AS x(user_id, credit) WHERE u.user_id = x.user_id`,
      [ids, credits],
    );
    const status = winner === "void" ? "voided" : "resolved";
    await c.query("UPDATE markets SET status = $2 WHERE market_id = $1", [marketId, status]);
    await c.query(
      `INSERT INTO resolutions (market_id, winning_outcome_index, resolved_by, rationale, resolved_at, dispute_deadline, status)
       VALUES ($1, $2, $3, $4, now(), now() + interval '24 hours', $5)
       ON CONFLICT (market_id) DO UPDATE SET winning_outcome_index = EXCLUDED.winning_outcome_index,
         resolved_by = EXCLUDED.resolved_by, rationale = EXCLUDED.rationale, resolved_at = now(),
         dispute_deadline = EXCLUDED.dispute_deadline, final_at = NULL, status = EXCLUDED.status`,
      [marketId, winner === "void" ? null : winner, user.user_id, note || null, status],
    );
    return { status, traders: byUser.size, paidOut: credits.reduce((a, x) => a + x, 0) };
  });
  clearWarehouseCache();
  const refreshRunId = await triggerRefresh();
  return { ...out, refreshRunId };
}

const adminEmails = () =>
  (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

/** Team admins (ADMIN_EMAILS, a Databricks secret on the app; never committed): can resolve and create markets. */
export const isAdmin = (u: { email: string }) => adminEmails().includes(u.email.toLowerCase());

/** 500+ true Clout (balance + open stake), or an admin. */
export const canResolve = (u: { email: string; clout: number; open_stake: number }) =>
  privileges(u.clout + u.open_stake).includes("resolve") || isAdmin(u);

export type NewMarket = {
  question: string;
  course: string;
  market_type: "binary" | "multiple_choice";
  outcomes?: string[]; // multiple choice only
  closes_at: string; // ISO
  resolution_source?: string;
  liquidity_b?: number;
  not_about_a_student: boolean;
};

/**
 * Create a live market (admins only for now; proposals with upvotes come later). One transaction inserts the
 * market and its outcomes at q = 0, so every outcome starts at an equal price.
 */
export async function createMarket(user: { user_id: string; email: string; school_id: string }, input: Partial<NewMarket>) {
  if (!isAdmin(user)) throw new TradeError("Only admins can create markets right now.", 403);
  const question = String(input.question ?? "").trim();
  const course = String(input.course ?? "").trim().slice(0, 40) || "campus";
  if (question.length < 10 || question.length > 200) throw new TradeError("Questions are 10–200 characters.");
  if (!input.not_about_a_student) throw new TradeError("Markets can't be about individual students. Confirm the box.");
  const type = input.market_type === "multiple_choice" ? "multiple_choice" : "binary";
  const labels =
    type === "binary"
      ? ["Yes", "No"]
      : [...new Set((input.outcomes ?? []).map((o) => String(o).trim()).filter(Boolean))].map((o) => o.slice(0, 60));
  if (labels.length < 2 || labels.length > 8) throw new TradeError("Multiple choice markets need 2–8 different outcomes.");
  const closes = Date.parse(String(input.closes_at ?? ""));
  if (!Number.isFinite(closes) || closes < Date.now() + 5 * 60e3) throw new TradeError("Pick a close time at least 5 minutes from now.");
  if (closes > Date.now() + 366 * 86400e3) throw new TradeError("Close time must be within a year.");
  const b = Number(input.liquidity_b ?? DEFAULT_B);
  if (!(b >= 50 && b <= 5000)) throw new TradeError("Liquidity b must be between 50 and 5000.");
  const marketId = `m-${crypto.randomUUID()}`;
  await tx(async (c) => {
    await c.query(
      `INSERT INTO markets (market_id, school_id, course, question, market_type, status, liquidity_b, creator_id,
                            resolution_source, opens_at, closes_at)
       VALUES ($1,$2,$3,$4,$5,'live',$6,$7,$8,now(),$9)`,
      [marketId, user.school_id, course, question, type, b, user.user_id, String(input.resolution_source ?? "").trim().slice(0, 300) || null, new Date(closes)],
    );
    await c.query(
      `INSERT INTO outcomes (market_id, outcome_index, label, q_shares)
       SELECT $1, i - 1, label, 0 FROM unnest($2::text[]) WITH ORDINALITY AS x(label, i)`,
      [marketId, labels],
    );
  });
  return { marketId };
}

export async function addComment(userId: string, marketId: string, body: string) {
  const text = body.trim().slice(0, 500);
  if (!text) throw new TradeError("Comment is empty.");
  const exists = await q("SELECT 1 FROM markets WHERE market_id = $1", [marketId]);
  if (!exists.length) throw new TradeError("Market not found.", 404);
  const commentId = `c-${crypto.randomUUID()}`;
  const [row] = await q<{ created_at: string }>(
    `INSERT INTO comments (comment_id, market_id, user_id, body) VALUES ($1,$2,$3,$4)
     RETURNING to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at`,
    [commentId, marketId, userId, text],
  );
  return { commentId, created_at: row.created_at };
}

/** Soft-delete your own comment. */
export async function deleteComment(userId: string, commentId: string) {
  const rows = await q<{ user_id: string }>("SELECT user_id FROM comments WHERE comment_id = $1 AND deleted_at IS NULL", [commentId]);
  if (!rows[0]) throw new TradeError("Comment not found.", 404);
  if (rows[0].user_id !== userId) throw new TradeError("You can only delete your own comments.", 403);
  await q("UPDATE comments SET deleted_at = now() WHERE comment_id = $1", [commentId]);
}
