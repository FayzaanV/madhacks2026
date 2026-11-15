import "server-only";
import type { PoolClient } from "pg";
import { applySell, applyTrade, DEFAULT_B, prices, sellProceeds, sharesForProceeds } from "@/core/lmsr";
import { challengeCredits, challengeDeltas, parseMentions, type Challenge } from "@/core/social";
import { notify } from "./notify";
import { canAfford, overrideDeltas, privileges, sellBasis, settlementCredits, type Winner } from "@/core/clout";
import { latestClose, validateRule, type AutoRule } from "@/core/auto-rules";
import { activeLook, type Look } from "@/core/cosmetics";
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
  auto_rule: string | null; // weather / rec-center rule JSON (core/auto-rules.ts); settled by server/campus-data.ts
  n_trades: number;
  volume: number;
  outcomes: Outcome[];
  category: "academic" | "sports" | "intramural" | "union" | string;
  sport: string | null;
  event_ref: string | null;
  market_kind: string | null;
  opening_note: string | null;
  /** Live/final score for sports and intramural markets. */
  game: GameBadge | null;
  /** Private group market (members only); null = public. */
  group_id: string | null;
  group_name: string | null;
  creator_id: string | null;
};

export type GameBadge = {
  kind: "sports" | "intramural";
  state: "pre" | "in" | "post";
  detail: string | null;
  home: string;
  away: string;
  home_score: number | null;
  away_score: number | null;
  starts_at: string;
  link: string;
};

function withPrices<T extends { liquidity_b: number; outcomes: Omit<Outcome, "price">[] }>(m: T) {
  const p = prices(m.outcomes.map((o) => o.q_shares), m.liquidity_b);
  return { ...m, outcomes: m.outcomes.map((o, i) => ({ ...o, price: p[i] })) };
}

const MARKET_SQL = `
  SELECT m.market_id, m.course, m.question, m.market_type, m.status, m.liquidity_b, m.resolution_source,
         m.closes_at, m.is_simulated, m.closes_at < now() AS past_close,
         m.category, m.sport, m.event_ref, m.market_kind, m.opening_note, m.group_id, m.creator_id,
         (SELECT g.name FROM groups g WHERE g.group_id = m.group_id) AS group_name,
         CASE WHEN m.category = 'sports' THEN (
           SELECT json_build_object('kind', 'sports', 'state', sg.state, 'detail', sg.detail, 'home', sg.home_abbr,
                    'away', sg.away_abbr, 'home_score', sg.home_score, 'away_score', sg.away_score, 'starts_at', sg.starts_at,
                    'link', '/sports#' || sg.event_id)
           FROM sports_games sg WHERE sg.event_id = m.event_ref)
         WHEN m.category = 'intramural' THEN (
           SELECT json_build_object('kind', 'intramural',
                    'state', CASE WHEN g.status IN ('final', 'forfeit', 'canceled') THEN 'post'
                                  WHEN g.starts_at < now() THEN 'in' ELSE 'pre' END,
                    'detail', initcap(g.status), 'home', ht.name, 'away', at.name, 'home_score', g.home_score,
                    'away_score', g.away_score, 'starts_at', g.starts_at, 'link', '/intramurals/' || g.game_id)
           FROM im_games g JOIN im_teams ht ON ht.team_id = g.home_team_id JOIN im_teams at ON at.team_id = g.away_team_id
           WHERE 'im:' || g.game_id = m.event_ref) END AS game,
         r.winning_outcome_index, r.rationale AS resolution_note, m.auto_rule,
         (SELECT count(*)::int FROM trades t WHERE t.market_id = m.market_id) AS n_trades,
         (SELECT coalesce(sum(abs(clout_spent)), 0)::float FROM trades t WHERE t.market_id = m.market_id) AS volume,
         (SELECT json_agg(json_build_object('outcome_index', o.outcome_index, 'label', o.label, 'q_shares', o.q_shares)
                          ORDER BY o.outcome_index) FROM outcomes o WHERE o.market_id = m.market_id) AS outcomes
  FROM markets m LEFT JOIN resolutions r USING (market_id)`;

/**
 * Markets from the Lakebase ledger, most traded first. "live" = still open for trading; "awaiting" = past
 * closes_at but not resolved yet; anything else is a raw status (resolved, final, voided...).
 */
export async function listMarkets(status = "live"): Promise<Market[]> {
  // Public lists never include private group markets (see listGroupMarkets / getVisibleMarket).
  const where =
    (status === "live"
      ? "m.status = 'live' AND m.closes_at > now()"
      : status === "awaiting"
        ? "m.status = 'live' AND m.closes_at <= now()"
        : "m.status = $1") + " AND m.group_id IS NULL";
  const rows = await q<Market>(
    `${MARKET_SQL} WHERE ${where} ORDER BY volume DESC`,
    status === "live" || status === "awaiting" ? [] : [status],
  );
  return rows.map(withPrices);
}

/** Any market by id, with no visibility check. Pages and APIs should use getVisibleMarket. */
export async function getMarket(id: string): Promise<Market | null> {
  const rows = await q<Market>(`${MARKET_SQL} WHERE m.market_id = $1`, [id]);
  return rows[0] ? withPrices(rows[0]) : null;
}

export async function isGroupMember(groupId: string, userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const r = await q("SELECT 1 FROM group_members m JOIN groups g USING (group_id) WHERE m.group_id = $1 AND m.user_id = $2 AND g.deleted_at IS NULL", [
    groupId,
    userId,
  ]);
  return r.length > 0;
}

/** A market the user may see: public markets for everyone, group markets for that group's members only. */
export async function getVisibleMarket(id: string, userId: string | null | undefined): Promise<Market | null> {
  const m = await getMarket(id);
  if (!m) return null;
  if (m.group_id && !(await isGroupMember(m.group_id, userId))) return null;
  return m;
}

/** A group's markets (members only; callers check membership). */
export async function listGroupMarkets(groupId: string): Promise<Market[]> {
  const rows = await q<Market>(`${MARKET_SQL} WHERE m.group_id = $1 ORDER BY m.created_at DESC`, [groupId]);
  return rows.map(withPrices);
}

export type Comment = {
  comment_id: string;
  user_id: string;
  handle: string;
  title: string | null;
  avatar_v: number | null;
  is_simulated: boolean;
  clout: number;
  look: Look; // shop cosmetics showing right now
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
    q<Omit<Comment, "look"> & { cosmetics: string | null }>(
      `SELECT c.comment_id, c.user_id, u.handle, u.title, u.is_simulated, u.cosmetics,
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
  const page = rows.slice(0, COMMENT_PAGE).map(({ cosmetics, ...c }) => ({ ...c, look: activeLook(cosmetics, c.clout) }));
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
      await c.query(
        "SELECT status, liquidity_b, course, group_id, closes_at < now() AS past_close FROM markets WHERE market_id = $1 FOR SHARE",
        [marketId],
      )
    ).rows[0];
    if (!m) throw new TradeError("Market not found.", 404);
    if (m.group_id) {
      const member = await c.query("SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2", [m.group_id, userId]);
      if (!member.rowCount) throw new TradeError("Market not found.", 404); // private group market
    }
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
    // Intramural captains report their game's result, so they can't trade that game's market.
    const captain = await c.query(
      `SELECT 1 FROM markets mk JOIN im_games g ON mk.event_ref = 'im:' || g.game_id
       JOIN im_teams t ON t.team_id IN (g.home_team_id, g.away_team_id)
       WHERE mk.market_id = $1 AND t.captain_user_id = $2 LIMIT 1`,
      [marketId, userId],
    );
    if (captain.rowCount) throw new TradeError("Captains can't trade on their own team's game.", 403);
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
 * Pay out head-to-head challenges on a market inside its settlement transaction. First settlement: accepted
 * challenges pay 2x stake to the right side (refund on void or when neither side's outcome won); pending ones are
 * cancelled (no stakes were taken). Override: settled challenges move by the difference (challengeDeltas).
 */
async function settleChallenges(c: PoolClient, marketId: string, previous: Winner | null, winner: Winner) {
  const rows = (
    await c.query(
      `SELECT challenge_id, challenger_id, opponent_id, challenger_outcome, opponent_outcome, stake, status FROM challenges
       WHERE market_id = $1 AND status IN ('pending', 'accepted', 'settled', 'void') FOR UPDATE`,
      [marketId],
    )
  ).rows as (Challenge & { challenge_id: string; status: string })[];
  const moves = new Map<string, number>();
  const add = (u: string, x: number) => moves.set(u, (moves.get(u) ?? 0) + x);
  for (const ch of rows) {
    if (ch.status === "pending") {
      await c.query("UPDATE challenges SET status = 'cancelled' WHERE challenge_id = $1", [ch.challenge_id]);
      continue;
    }
    if (ch.status === "accepted" || previous === null) {
      if (ch.status !== "accepted") continue;
      const { credits } = challengeCredits(ch, winner);
      for (const [u, x] of Object.entries(credits)) add(u, x);
    } else {
      for (const [u, x] of Object.entries(challengeDeltas(ch, previous, winner))) add(u, x);
    }
    const { winnerId } = challengeCredits(ch, winner);
    await c.query("UPDATE challenges SET status = $2, winner_id = $3, settled_at = now() WHERE challenge_id = $1", [
      ch.challenge_id,
      winner === "void" ? "void" : "settled",
      winnerId,
    ]);
    for (const u of [ch.challenger_id, ch.opponent_id]) {
      const msg = !winnerId ? "Stakes refunded." : winnerId === u ? `You won ${2 * ch.stake} Clout!` : `You lost your ${ch.stake} Clout stake.`;
      await notify([u], "challenge_result", marketId, null, `Challenge settled: ${msg}`, c);
    }
  }
  if (moves.size)
    await c.query(
      `UPDATE users u SET clout = u.clout + x.credit FROM unnest($1::text[], $2::float8[]) AS x(user_id, credit)
       WHERE u.user_id = x.user_id`,
      [[...moves.keys()], [...moves.values()]],
    );
}

/**
 * Resolve a market (or void it). One Postgres transaction that:
 *   - requires the resolve privilege (500+ true Clout = balance + open stake), or an admin
 *   - locks the market (trades take it FOR SHARE, so none land mid-resolution), records the resolution with a
 *     24h dispute deadline and sets status resolved/voided
 *   - pays out with settlementCredits: each winning share still held credits 1 Clout; a voided market reverses
 *     every trader's net cash flow
 * Override (admins only): an already settled market can be re-resolved; balances move by only the difference
 * between the new and old outcome (overrideDeltas), and the rationale keeps the previous outcome.
 * Then kicks off the refresh job (unless refresh: false, for batches) so gold catches up within minutes.
 */
export async function resolveMarket(
  user: { user_id: string; email: string; handle?: string; clout: number; open_stake: number },
  marketId: string,
  winner: Winner,
  rationale: string,
  { override = false }: { override?: boolean } = {},
) {
  const [g] = await q<{ group_id: string | null; creator_id: string | null; role: string | null }>(
    `SELECT m.group_id, m.creator_id, gm.role FROM markets m
     LEFT JOIN group_members gm ON gm.group_id = m.group_id AND gm.user_id = $2 WHERE m.market_id = $1`,
    [marketId, user.user_id],
  );
  if (!g) throw new TradeError("Market not found.", 404);
  if (g.group_id) {
    // Group markets: the creator resolves; the group's owner/admins can resolve or override. Clout doesn't matter.
    const groupAdmin = g.role === "owner" || g.role === "admin";
    if (!g.role) throw new TradeError("Market not found.", 404);
    if (override ? !groupAdmin : !(groupAdmin || g.creator_id === user.user_id))
      throw new TradeError(override ? "Only the group's owner or admins can override." : "Only the market's creator or group admins can resolve it.", 403);
  } else {
    if (!canResolve(user)) throw new TradeError("Resolving markets takes 500+ Clout.", 403);
    if (override && !isAdmin(user)) throw new TradeError("Only admins can override a resolution.", 403);
  }
  // A person resolving asks for a gold refresh (rate-limited in triggerRefresh); bots never do.
  return settleMarket(marketId, winner, rationale, user.user_id, { override, by: user.handle, refresh: true });
}

/**
 * Settle a market with no permission check: the payout transaction shared by manual resolution and the
 * auto-resolvers (sports poller as u-yomi-sports, intramurals as u-yomi-im, test markets as their creator).
 * Callers decide who may settle. `override` re-resolves a settled market (balances move by the difference);
 * `refresh` (off by default) asks for a gold refresh; auto-resolvers leave it off and the schedule catches up,
 * because a refresh per settled market exhausted the Free Edition compute quota.
 */
export async function settleMarket(
  marketId: string,
  winner: Winner,
  rationale: string,
  resolvedBy: string,
  { override = false, refresh = false, by }: { override?: boolean; refresh?: boolean; by?: string } = {},
) {
  const note = rationale.trim().slice(0, 1000);
  const out = await tx(async (c) => {
    const m = (await c.query("SELECT status FROM markets WHERE market_id = $1 FOR UPDATE", [marketId])).rows[0];
    if (!m) throw new TradeError("Market not found.", 404);
    const settled = ["resolved", "final", "voided", "disputed"].includes(m.status);
    if (settled && !override) throw new TradeError(`This market is already ${m.status}.`, 409);
    if (!settled && !["live", "closed"].includes(m.status)) throw new TradeError(`This market is ${m.status}.`, 409);
    const n = (await c.query("SELECT count(*)::int AS n FROM outcomes WHERE market_id = $1", [marketId])).rows[0].n as number;
    if (winner !== "void" && !(Number.isInteger(winner) && winner >= 0 && winner < n)) throw new TradeError("Unknown outcome.");

    let previous: Winner | null = null;
    if (settled) {
      const r = (await c.query("SELECT winning_outcome_index FROM resolutions WHERE market_id = $1", [marketId])).rows[0];
      previous = m.status === "voided" || r?.winning_outcome_index == null ? "void" : (r.winning_outcome_index as number);
      if (previous === winner) throw new TradeError("That's already the outcome.", 409);
    }
    const trades = (
      await c.query("SELECT user_id, outcome_index, clout_spent, shares FROM trades WHERE market_id = $1", [marketId])
    ).rows.map((r) => [r.user_id, r.outcome_index, r.clout_spent, r.shares] as const);
    const moves = previous === null ? settlementCredits(trades, winner) : overrideDeltas(trades, previous, winner);
    await c.query(
      `UPDATE users u SET clout = u.clout + x.credit
       FROM unnest($1::text[], $2::float8[]) AS x(user_id, credit) WHERE u.user_id = x.user_id`,
      [[...moves.keys()], [...moves.values()]],
    );
    await settleChallenges(c, marketId, previous, winner);
    const status = winner === "void" ? "voided" : "resolved";
    const label = (w: Winner) => (w === "void" ? "void" : `outcome ${w + 1}`);
    const why =
      previous === null
        ? note || null
        : `Overridden by @${by ?? resolvedBy} (was ${label(previous)})${note ? `: ${note}` : ""}`;
    await c.query("UPDATE markets SET status = $2 WHERE market_id = $1", [marketId, status]);
    await c.query(
      `INSERT INTO resolutions (market_id, winning_outcome_index, resolved_by, rationale, resolved_at, dispute_deadline, status)
       VALUES ($1, $2, $3, $4, now(), now() + interval '24 hours', $5)
       ON CONFLICT (market_id) DO UPDATE SET winning_outcome_index = EXCLUDED.winning_outcome_index,
         resolved_by = EXCLUDED.resolved_by, rationale = EXCLUDED.rationale, resolved_at = now(),
         dispute_deadline = EXCLUDED.dispute_deadline, final_at = NULL, status = EXCLUDED.status`,
      [marketId, winner === "void" ? null : winner, resolvedBy, why, status],
    );
    return {
      status,
      overridden: previous !== null,
      traders: new Set(trades.map((t) => t[0])).size,
      paidOut: [...moves.values()].reduce((a, x) => a + x, 0),
    };
  });
  clearWarehouseCache();
  const refreshRunId = refresh ? await triggerRefresh() : null;
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
  auto_rule?: unknown; // weather / rec-center rule (core/auto-rules.ts): Yes/No, settled automatically from data
  group_id?: string; // private group market: any member may create it
  tagged?: string[]; // user ids the market is about (group markets only; must be members)
};

export const WEATHER_SOURCE = "Open-Meteo (open-meteo.com), Madison daily values";
export const FACILITY_SOURCE = "UW Rec Well live facility counts (recwell.wisc.edu)";

/**
 * Create a live market (admins only for now; proposals with upvotes come later). One transaction inserts the
 * market and its outcomes at q = 0, so every outcome starts at an equal price.
 */
export async function createMarket(user: { user_id: string; email: string; school_id: string }, input: Partial<NewMarket>) {
  const groupId = input.group_id ? String(input.group_id) : null;
  const question = String(input.question ?? "").trim();
  if (question.length < 10 || question.length > 200) throw new TradeError("Questions are 10–200 characters.");
  // Public markets: admins only, never about a person. Group markets: any member; may be about members (tagged),
  // and every @mention in the question must be a member too.
  let tagged: string[] = [];
  let groupName = "";
  if (groupId) {
    const [g] = await q<{ name: string }>(
      `SELECT g.name FROM groups g JOIN group_members gm ON gm.group_id = g.group_id
       WHERE g.group_id = $1 AND gm.user_id = $2 AND g.deleted_at IS NULL`,
      [groupId, user.user_id],
    );
    if (!g) throw new TradeError("You're not in that group.", 403);
    groupName = g.name;
    const ids = [...new Set((input.tagged ?? []).map(String))];
    const handles = parseMentions(question);
    const members = await q<{ user_id: string; handle: string }>(
      `SELECT u.user_id, lower(u.handle) AS handle FROM group_members gm JOIN users u USING (user_id) WHERE gm.group_id = $1`,
      [groupId],
    );
    const bad = handles.filter((h) => !members.some((m) => m.handle === h));
    if (bad.length) throw new TradeError(`You can only tag people in this group (not @${bad.join(", @")}).`);
    if (ids.some((id) => !members.some((m) => m.user_id === id))) throw new TradeError("You can only tag people in this group.");
    tagged = [...new Set([...ids, ...members.filter((m) => handles.includes(m.handle)).map((m) => m.user_id)])];
  } else {
    if (!isAdmin(user)) throw new TradeError("Only admins can create public markets right now.", 403);
    if (!input.not_about_a_student) throw new TradeError("Markets can't be about individual students. Confirm the box.");
    if (parseMentions(question).length || input.tagged?.length)
      throw new TradeError("Public markets can't tag people. Make it in a group instead.");
  }
  const course = groupId ? groupName.slice(0, 40) : String(input.course ?? "").trim().slice(0, 40) || "campus";
  let rule: AutoRule | null = null;
  if (input.auto_rule) {
    const v = validateRule(input.auto_rule);
    if ("error" in v) throw new TradeError(v.error);
    rule = v.rule;
  }
  const type = rule ? "binary" : input.market_type === "multiple_choice" ? "multiple_choice" : "binary";
  const labels =
    type === "binary"
      ? ["Yes", "No"]
      : [...new Set((input.outcomes ?? []).map((o) => String(o).trim()).filter(Boolean))].map((o) => o.slice(0, 60));
  if (labels.length < 2 || labels.length > 8) throw new TradeError("Multiple choice markets need 2–8 different outcomes.");
  const closes = Date.parse(String(input.closes_at ?? ""));
  if (!Number.isFinite(closes) || closes < Date.now() + 5 * 60e3) throw new TradeError("Pick a close time at least 5 minutes from now.");
  if (closes > Date.now() + 366 * 86400e3) throw new TradeError("Close time must be within a year.");
  if (rule && closes > latestClose(rule))
    throw new TradeError("Trading has to close before the answer is known: by the start of that day, or by the check time.");
  const source = rule
    ? rule.kind === "weather" ? WEATHER_SOURCE : FACILITY_SOURCE
    : String(input.resolution_source ?? "").trim().slice(0, 300) || null;
  const b = Number(input.liquidity_b ?? DEFAULT_B);
  if (!(b >= 50 && b <= 5000)) throw new TradeError("Liquidity b must be between 50 and 5000.");
  const marketId = `m-${crypto.randomUUID()}`;
  await tx(async (c) => {
    await c.query(
      `INSERT INTO markets (market_id, school_id, course, question, market_type, status, liquidity_b, creator_id,
                            resolution_source, opens_at, closes_at, category, market_kind, auto_resolve, auto_rule, group_id)
       VALUES ($1,$2,$3,$4,$5,'live',$6,$7,$8,now(),$9,$10,$11,$12,$13,$14)`,
      [marketId, user.school_id, rule ? "campus" : course, question, type, b, user.user_id, source, new Date(closes),
       rule ? "campus" : groupId ? "group" : "academic", rule ? rule.kind : null, Boolean(rule), rule ? JSON.stringify(rule) : null,
       groupId],
    );
    if (tagged.length)
      await c.query("INSERT INTO market_tags (market_id, user_id) SELECT $1, u FROM unnest($2::text[]) AS u", [marketId, tagged]);
    await c.query(
      `INSERT INTO outcomes (market_id, outcome_index, label, q_shares)
       SELECT $1, i - 1, label, 0 FROM unnest($2::text[]) WITH ORDINALITY AS x(label, i)`,
      [marketId, labels],
    );
  });
  if (tagged.length)
    await notify(tagged, "tagged", marketId, user.user_id, `A market in ${groupName} is about you: "${question}". You can veto it.`);
  return { marketId };
}

export async function addComment(userId: string, marketId: string, body: string) {
  const text = body.trim().slice(0, 500);
  if (!text) throw new TradeError("Comment is empty.");
  const [m] = await q<{ group_id: string | null }>("SELECT group_id FROM markets WHERE market_id = $1", [marketId]);
  if (!m || (m.group_id && !(await isGroupMember(m.group_id, userId)))) throw new TradeError("Market not found.", 404);
  // Tagging people: only inside a private group, and only that group's members (public markets stay person-free).
  const handles = parseMentions(text);
  let mentioned: string[] = [];
  if (handles.length) {
    if (!m.group_id) throw new TradeError("You can only tag people in group markets.");
    const found = await q<{ user_id: string; handle: string }>(
      `SELECT u.user_id, lower(u.handle) AS handle FROM users u JOIN group_members gm ON gm.user_id = u.user_id
       WHERE gm.group_id = $1 AND lower(u.handle) = ANY($2)`,
      [m.group_id, handles],
    );
    const missing = handles.filter((h) => !found.some((f) => f.handle === h));
    if (missing.length) throw new TradeError(`You can only tag people in this group (not @${missing.join(", @")}).`);
    mentioned = found.map((f) => f.user_id);
  }
  const commentId = `c-${crypto.randomUUID()}`;
  const [row] = await q<{ created_at: string }>(
    `INSERT INTO comments (comment_id, market_id, user_id, body) VALUES ($1,$2,$3,$4)
     RETURNING to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at`,
    [commentId, marketId, userId, text],
  );
  await notify(mentioned, "mentioned", marketId, userId, text.slice(0, 140));
  return { commentId, created_at: row.created_at };
}

/** Soft-delete your own comment. */
export async function deleteComment(userId: string, commentId: string) {
  const rows = await q<{ user_id: string }>("SELECT user_id FROM comments WHERE comment_id = $1 AND deleted_at IS NULL", [commentId]);
  if (!rows[0]) throw new TradeError("Comment not found.", 404);
  if (rows[0].user_id !== userId) throw new TradeError("You can only delete your own comments.", 403);
  await q("UPDATE comments SET deleted_at = now() WHERE comment_id = $1", [commentId]);
}
