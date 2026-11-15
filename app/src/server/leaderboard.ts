import "server-only";
import { q } from "./ledger";
import { querySql } from "./warehouse";

/**
 * Live leaderboards sorted straight from the Lakebase ledger (a plain SQL sort), instead of reading the gold
 * leaderboard through the SQL warehouse: always current, and no warehouse compute. Same row shapes the pages
 * used before. Clout = balance + cost basis still held (what the header shows; equals gold's 100 + realized).
 * Only Brier comes from gold (one cached query for the users shown), "–" when unavailable.
 */

export type LeaderRow = {
  user_id: string;
  handle: string;
  school_id: string | null;
  is_simulated: boolean;
  clout: number;
  brier: number | null;
  n_trades: number;
  rank: number;
  rank_from_bottom: number;
};

export type SchoolRow = {
  school_id: string;
  name: string | null;
  short_name: string | null;
  color: string | null;
  forecasters: number;
  avg_clout: number;
  avg_brier: number | null;
  top_clout: number;
  rank: number;
};

/** User-attribute scopes and the users column each filters on (a fixed map: only these names reach the SQL). */
const USER_COLUMN = { school: "school_id", major: "major", dorm: "dorm", club: "club" } as const;
export type Scope = "overall" | keyof typeof USER_COLUMN | "course";
export const isScope = (s: unknown): s is Scope => s === "overall" || s === "course" || (typeof s === "string" && s in USER_COLUMN);

/** Every forecaster (1+ trade) with true Clout. $-free: callers add their own WHERE on b.* columns. */
const BASE = `
  WITH b AS (
    SELECT u.user_id, u.handle, u.school_id, u.major, u.dorm, u.club, u.is_simulated,
           (u.clout + coalesce(o.open, 0))::float AS clout, a.n AS n_trades
    FROM users u
    JOIN (SELECT user_id, count(*)::int AS n FROM trades GROUP BY user_id) a USING (user_id)
    LEFT JOIN (SELECT t.user_id, sum(t.basis_change) AS open FROM trades t JOIN markets m USING (market_id)
               WHERE m.status NOT IN ('resolved', 'final', 'voided') GROUP BY t.user_id) o USING (user_id)
    WHERE u.deleted_at IS NULL)`;

/** Clout realized per user in one course: winning shares held minus net Clout put in, resolved markets only. */
const COURSE = `
  WITH b AS (
    SELECT t.user_id, u.handle, u.school_id, u.is_simulated,
           sum(CASE WHEN t.outcome_index = r.winning_outcome_index THEN t.shares ELSE 0 END - t.clout_spent)::float AS clout,
           count(*)::int AS n_trades
    FROM trades t JOIN markets m USING (market_id) JOIN resolutions r USING (market_id) JOIN users u USING (user_id)
    WHERE m.status IN ('resolved', 'final') AND m.course = $1 AND u.deleted_at IS NULL
    GROUP BY t.user_id, u.handle, u.school_id, u.is_simulated)`;

const RANKED = `
  SELECT user_id, handle, school_id, is_simulated, clout, n_trades,
         rank() OVER (ORDER BY clout DESC)::int AS rank, rank() OVER (ORDER BY clout ASC)::int AS rank_from_bottom
  FROM b`;

/** Brier scores from gold for just these users (cached 30 min; empty in local mode or if gold is missing). */
async function briers(ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const params = Object.fromEntries(ids.map((id, i) => [`u${i}`, id]));
  const rows = await querySql<{ user_id: string; brier: number }>(
    `SELECT user_id, brier FROM {catalog}.gold.user_brier WHERE user_id IN (${ids.map((_, i) => `:u${i}`).join(", ")})`,
    params,
  ).catch(() => []);
  return new Map(rows.map((r) => [r.user_id, r.brier]));
}

/** Top `top` and bottom `bottom` (Hall of Shame) of a scope, ranked live. */
export async function leaderboard(scope: Scope, value: string, top = 25, bottom = 10) {
  const [sql, params] =
    scope === "course"
      ? [`${COURSE} SELECT * FROM (${RANKED}) x`, [value]]
      : scope === "overall"
        ? [`${BASE} SELECT * FROM (${RANKED}) x`, []]
        : [`${BASE.replace("WHERE u.deleted_at IS NULL", `WHERE u.deleted_at IS NULL AND u.${USER_COLUMN[scope]} = $1`)} SELECT * FROM (${RANKED}) x`, [value]];
  const [best, worst] = await Promise.all([
    q<Omit<LeaderRow, "brier">>(`${sql} ORDER BY rank, handle LIMIT ${top}`, params),
    q<Omit<LeaderRow, "brier">>(`${sql} ORDER BY rank_from_bottom, handle LIMIT ${bottom}`, params),
  ]);
  const b = await briers([...new Set([...best, ...worst].map((r) => r.user_id))]);
  const withBrier = (rs: Omit<LeaderRow, "brier">[]) => rs.map((r) => ({ ...r, brier: b.get(r.user_id) ?? null }));
  return { top: withBrier(best), shame: withBrier(worst) };
}

/** Values a scope can take (majors, dorms, clubs, courses with resolved markets), sorted. */
export async function scopeValues(scope: Scope): Promise<string[]> {
  if (scope === "overall") return ["all"];
  if (scope === "course") {
    const rows = await q<{ v: string }>(
      `SELECT DISTINCT m.course AS v FROM markets m JOIN resolutions r USING (market_id)
       WHERE m.status IN ('resolved', 'final') AND EXISTS (SELECT 1 FROM trades t WHERE t.market_id = m.market_id) ORDER BY 1`,
    );
    return rows.map((r) => r.v);
  }
  const col = USER_COLUMN[scope];
  const rows = await q<{ v: string }>(
    `SELECT DISTINCT u.${col} AS v FROM users u WHERE u.${col} IS NOT NULL AND u.${col} <> 'none'
       AND u.deleted_at IS NULL AND EXISTS (SELECT 1 FROM trades t WHERE t.user_id = u.user_id) ORDER BY 1`,
  );
  return rows.map((r) => r.v);
}

/** Inter-campus league: schools ranked by their forecasters' average Clout (avg Brier from gold when available). */
export async function schoolLeague(): Promise<SchoolRow[]> {
  const [rows, gold] = await Promise.all([
    q<Omit<SchoolRow, "avg_brier">>(
      `${BASE}
       SELECT b.school_id, s.name, s.short_name, s.color, count(*)::int AS forecasters, avg(b.clout)::float AS avg_clout,
              max(b.clout)::float AS top_clout, rank() OVER (ORDER BY avg(b.clout) DESC)::int AS rank
       FROM b LEFT JOIN schools s USING (school_id) WHERE b.school_id IS NOT NULL
       GROUP BY b.school_id, s.name, s.short_name, s.color ORDER BY rank`,
    ),
    querySql<{ school_id: string; avg_brier: number | null }>("SELECT school_id, avg_brier FROM {catalog}.gold.school_rankings").catch(
      () => [],
    ),
  ]);
  const brier = new Map(gold.map((g) => [g.school_id, g.avg_brier]));
  return rows.map((r) => ({ ...r, avg_brier: brier.get(r.school_id) ?? null }));
}

/** A user's live overall rank (null if they haven't traded). */
export async function overallRank(userId: string): Promise<number | null> {
  const r = await q<{ rank: number }>(`${BASE} SELECT rank FROM (${RANKED}) x WHERE user_id = $1`, [userId]);
  return r[0]?.rank ?? null;
}
