import "server-only";
import { prices } from "@/core/lmsr";
import { q } from "./ledger";
import { querySql } from "./warehouse";

/**
 * Positions, trade history, market activity and live odds, all read from the Lakebase ledger (live after every
 * trade). Trades are signed: position = sum(shares), cost basis = sum(basis_change). See db/schema.sql.
 */

/** Public identity shown next to a bet or comment: handle, avatar version, chosen title. */
export type Person = { user_id: string; handle: string; avatar_v: number | null; title: string | null };
const PERSON_SQL = `u.user_id, u.handle, u.title, extract(epoch FROM u.avatar_updated_at)::int AS avatar_v`;

type MarketQ = { liquidity_b: number; q: number[]; labels: string[] };

/** Current LMSR price per outcome for a set of markets. */
async function marketPrices(ids: string[]): Promise<Map<string, MarketQ & { p: number[] }>> {
  if (!ids.length) return new Map();
  const rows = await q<{ market_id: string; liquidity_b: number; q: number[]; labels: string[] }>(
    `SELECT m.market_id, m.liquidity_b, array_agg(o.q_shares ORDER BY o.outcome_index) AS q,
            array_agg(o.label ORDER BY o.outcome_index) AS labels
     FROM markets m JOIN outcomes o USING (market_id) WHERE m.market_id = ANY($1) GROUP BY m.market_id, m.liquidity_b`,
    [ids],
  );
  return new Map(rows.map((r) => [r.market_id, { ...r, p: prices(r.q, r.liquidity_b) }]));
}

export type Position = {
  market_id: string;
  question: string;
  course: string;
  status: string;
  outcome_index: number;
  label: string;
  shares: number; // held now
  basis: number; // what you paid for the shares you hold
  avg_price: number;
  price: number; // current crowd price
  value: number; // mark-to-market: shares * price
  pnl: number; // value - basis (open) or realized (resolved)
  winning_outcome_index: number | null;
};

/** Your positions, open and settled. Settled P&L = payout - net Clout put in. */
export async function positions(userId: string, marketId?: string): Promise<Position[]> {
  const rows = await q<{
    market_id: string;
    question: string;
    course: string;
    status: string;
    outcome_index: number;
    shares: number;
    basis: number;
    net_spent: number;
    winning_outcome_index: number | null;
  }>(
    `SELECT t.market_id, m.question, m.course, m.status, t.outcome_index,
            sum(t.shares)::float AS shares, sum(t.basis_change)::float AS basis, sum(t.clout_spent)::float AS net_spent,
            r.winning_outcome_index
     FROM trades t JOIN markets m USING (market_id) LEFT JOIN resolutions r USING (market_id)
     WHERE t.user_id = $1 AND ($2::text IS NULL OR t.market_id = $2)
     GROUP BY t.market_id, m.question, m.course, m.status, t.outcome_index, r.winning_outcome_index
     ORDER BY max(t.created_at) DESC`,
    [userId, marketId ?? null],
  );
  const mp = await marketPrices([...new Set(rows.map((r) => r.market_id))]);
  return rows
    .map((r) => {
      const m = mp.get(r.market_id);
      const settled = ["resolved", "final"].includes(r.status) && r.winning_outcome_index != null;
      const price = settled ? (r.outcome_index === r.winning_outcome_index ? 1 : 0) : (m?.p[r.outcome_index] ?? 0);
      const value = r.shares * price;
      return {
        ...r,
        label: m?.labels[r.outcome_index] ?? `#${r.outcome_index}`,
        avg_price: r.shares > 1e-9 ? r.basis / r.shares : 0,
        price,
        value,
        pnl: settled ? value - r.net_spent : r.status === "voided" ? 0 : value - r.basis,
      };
    })
    .filter((p) => p.shares > 1e-6 || ["resolved", "final"].includes(p.status));
}

export type PortfolioSummary = {
  available: number;
  open_stake: number;
  clout: number; // available + open_stake (true Clout)
  positions_value: number; // mark-to-market of open positions
  portfolio_value: number; // available + positions_value
  unrealized: number;
  realized: number; // true Clout - 100, everything already locked in
};

export function summarize(available: number, open: Position[]): PortfolioSummary {
  const live = open.filter((p) => ["live", "closed"].includes(p.status));
  const openStake = live.reduce((a, p) => a + p.basis, 0);
  const value = live.reduce((a, p) => a + p.value, 0);
  return {
    available,
    open_stake: openStake,
    clout: available + openStake,
    positions_value: value,
    portfolio_value: available + value,
    unrealized: value - openStake,
    realized: available + openStake - 100,
  };
}

export type TradeRow = {
  trade_id: string;
  market_id: string;
  question: string;
  outcome_index: number;
  label: string;
  side: "buy" | "sell";
  shares: number;
  clout: number;
  price: number; // average fill price
  created_at: string;
};

const TRADE_COLS = `t.trade_id, t.market_id, t.outcome_index, t.side, abs(t.shares)::float AS shares,
  abs(t.clout_spent)::float AS clout, (abs(t.clout_spent) / nullif(abs(t.shares), 0))::float AS price, t.created_at,
  (SELECT o.label FROM outcomes o WHERE o.market_id = t.market_id AND o.outcome_index = t.outcome_index) AS label`;

export async function tradeHistory(userId: string, page = 0): Promise<TradeRow[]> {
  return q<TradeRow>(
    `SELECT ${TRADE_COLS}, m.question FROM trades t JOIN markets m USING (market_id)
     WHERE t.user_id = $1 ORDER BY t.created_at DESC LIMIT 50 OFFSET $2`,
    [userId, Math.max(0, page) * 50],
  );
}

/** Everyone's recent trades on a market (public: usernames, never emails). */
export async function marketActivity(marketId: string): Promise<(TradeRow & Person)[]> {
  return q<TradeRow & Person>(
    `SELECT ${TRADE_COLS}, ${PERSON_SQL} FROM trades t JOIN users u USING (user_id)
     WHERE t.market_id = $1 AND u.deleted_at IS NULL ORDER BY t.created_at DESC LIMIT 50`,
    [marketId],
  );
}

export type Holder = Person & { outcome_index: number; shares: number };

/** Top 10 holders per outcome by shares held now. */
export async function topHolders(marketId: string): Promise<Holder[]> {
  return q<Holder>(
    `SELECT * FROM (
       SELECT h.*, row_number() OVER (PARTITION BY h.outcome_index ORDER BY h.shares DESC) AS rn FROM (
         SELECT t.outcome_index, sum(t.shares)::float AS shares, ${PERSON_SQL}
         FROM trades t JOIN users u USING (user_id)
         WHERE t.market_id = $1 AND u.deleted_at IS NULL
         GROUP BY t.outcome_index, u.user_id, u.handle, u.title, u.avatar_updated_at
         HAVING sum(t.shares) > 0.01) h) x
     WHERE rn <= 10 ORDER BY outcome_index, shares DESC`,
    [marketId],
  );
}

/** Live odds after every trade (Lakebase), downsampled to ~400 points, plus Smart Money from gold. */
export type OddsPoint = { t: number; p: number[]; smart: number | null };
export async function oddsSeries(marketId: string): Promise<OddsPoint[]> {
  const [rows, smart] = await Promise.all([
    q<{ t: number; p: number[] }>(
      `SELECT (extract(epoch FROM created_at) * 1000)::float8 AS t, prices_after AS p
       FROM trades WHERE market_id = $1 ORDER BY created_at, trade_id`,
      [marketId],
    ),
    querySql<{ t: number; smart_price: number | null }>(
      `SELECT unix_millis(created_at) AS t, smart_price FROM {catalog}.gold.market_price_history
       WHERE market_id = :id AND outcome_index = 0 ORDER BY created_at`,
      { id: marketId },
    ).catch(() => []),
  ]);
  const step = Math.max(1, Math.ceil(rows.length / 400));
  const picked = rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
  // Smart Money is a step line: carry the latest gold value forward to each point.
  const sm = smart.map((s) => ({ t: s.t, v: s.smart_price }));
  let j = -1;
  return picked.map((r) => {
    while (j + 1 < sm.length && sm[j + 1].t <= r.t) j++;
    return { t: r.t, p: r.p, smart: j >= 0 ? sm[j].v : null };
  });
}

/** True Clout over time from gold (sells and resolutions), for the portfolio chart. `asOf` = when it was read. */
export async function cloutHistory(userId: string): Promise<{ points: { t: number; clout: number }[]; asOf: number }> {
  const rows = await querySql<{ t: number; clout: number }>(
    `SELECT unix_millis(at) AS t, clout FROM {catalog}.gold.user_clout_history WHERE user_id = :id ORDER BY at`,
    { id: userId },
  ).catch(() => []);
  return { points: rows, asOf: Date.now() };
}
