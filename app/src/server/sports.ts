import "server-only";
import type { PoolClient } from "pg";
import { prices } from "@/core/lmsr";
import { closesAt, decidedEarly, marketsForGame, openingProbs, parseEvent, ratingWinProb, resolveOutcome, scoreLine, sharesForProbs, SPORTS, totalLine, type Game, type MarketKind, type SportKey } from "@/core/sports";
import { UNIVERSITIES } from "@/core/universities";
import { q, tx } from "./ledger";
import { settleMarket } from "./markets";

/**
 * Varsity sports, from ESPN's public (unofficial, keyless) scoreboard JSON. May change without notice.
 *   syncSchedules: every team schedule for listed Big Ten schools -> sports_games (hourly)
 *   pollLive:      today's scoreboards for sports with a game on -> live scores (every minute)
 *   createMarkets: winner / total / margin / overtime markets for games in the next 8 days
 *   settleFinished: settle auto-resolve markets whose game is final (or postponed/canceled -> void)
 */
const ESPN = "https://site.api.espn.com/apis/site/v2/sports";
export const SPORTS_BOT = "u-yomi-sports";
const LIQUIDITY_B = 300;
const CREATE_AHEAD_DAYS = 8; // a week+ ahead, so next weekend's football is always open for betting
const BIG_TEN = UNIVERSITIES.filter((u) => u.espn_id && u.conference === "big-ten");

async function espn<T>(path: string): Promise<T> {
  const res = await fetch(`${ESPN}/${path}`, {
    headers: { "User-Agent": "Mozilla/5.0 (Yomi sports poller)", Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`ESPN ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

/** Run fn over items with limited parallelism so we don't hammer ESPN. */
async function eachLimit<T>(items: T[], limit: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]).catch((e) => console.warn("[sports]", String(e).slice(0, 200)));
    }),
  );
}

/** Upsert games in one statement (json_populate_recordset), only those involving a listed school. */
async function upsertGames(games: Game[]) {
  const rows = games
    .filter((g) => g.home.schoolId || g.away.schoolId)
    .map((g) => ({
      event_id: g.eventId, sport: g.sport, starts_at: g.startsAt, state: g.state, status_name: g.statusName,
      completed: g.completed, period: g.period, clock: g.clock, detail: g.detail,
      home_name: g.home.name, away_name: g.away.name, home_abbr: g.home.abbr, away_abbr: g.away.abbr,
      home_espn_id: g.home.espnId, away_espn_id: g.away.espnId, home_school_id: g.home.schoolId, away_school_id: g.away.schoolId,
      home_score: g.home.score, away_score: g.away.score, winner_side: g.winnerSide, overtime: g.overtime, ou_line: g.ouLine,
      updated_at: new Date().toISOString(),
    }));
  if (!rows.length) return;
  await q(
    `INSERT INTO sports_games SELECT * FROM json_populate_recordset(null::sports_games, $1::json)
     ON CONFLICT (event_id) DO UPDATE SET starts_at = EXCLUDED.starts_at, state = EXCLUDED.state,
       status_name = EXCLUDED.status_name, completed = EXCLUDED.completed, period = EXCLUDED.period,
       clock = EXCLUDED.clock, detail = EXCLUDED.detail,
       home_score = coalesce(EXCLUDED.home_score, sports_games.home_score),
       away_score = coalesce(EXCLUDED.away_score, sports_games.away_score),
       winner_side = EXCLUDED.winner_side, overtime = EXCLUDED.overtime,
       ou_line = coalesce(EXCLUDED.ou_line, sports_games.ou_line), updated_at = now()`,
    [JSON.stringify(rows)],
  );
}

type EspnEvents = { events?: Parameters<typeof parseEvent>[1][] };

/** Every listed Big Ten team's schedule in every sport: ~108 small requests, run hourly. */
export async function syncSchedules() {
  const jobs = (Object.keys(SPORTS) as SportKey[]).flatMap((sport) => BIG_TEN.map((u) => ({ sport, id: u.espn_id! })));
  let n = 0;
  await eachLimit(jobs, 4, async ({ sport, id }) => {
    const d = await espn<EspnEvents>(`${SPORTS[sport].path}/teams/${id}/schedule`);
    const games = (d.events ?? []).map((e) => parseEvent(sport, e));
    await upsertGames(games);
    n += games.length;
  });
  return n;
}

/**
 * ESPN scoreboard filter that returns every game involving a Big Ten team. Without it, football and basketball
 * only return featured games. (groups=50 looks like "all of Division I" but silently drops games: don't use it.)
 * Hockey and volleyball return all games unfiltered.
 */
const BIG_TEN_GROUP: Partial<Record<SportKey, string>> = { football: "5", "mens-basketball": "7", "womens-basketball": "7" };

const yyyymmdd = (d: Date) =>
  d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" }).replaceAll("-", "");

/** Live scores: only sports with a game in progress or starting/ending around now. */
export async function pollLive() {
  const active = await q<{ sport: SportKey }>(
    `SELECT DISTINCT sport FROM sports_games
     WHERE state = 'in'
        OR (state = 'pre' AND starts_at < now() + interval '15 minutes' AND starts_at > now() - interval '12 hours')
        OR (state = 'post' AND NOT completed AND starts_at > now() - interval '2 days')`,
  );
  const now = new Date();
  const dates = [yyyymmdd(new Date(now.getTime() - 86400e3)), yyyymmdd(now)];
  let n = 0;
  for (const { sport } of active) {
    for (const date of dates) {
      const group = BIG_TEN_GROUP[sport] ? `&groups=${BIG_TEN_GROUP[sport]}` : "";
      const d = await espn<EspnEvents>(`${SPORTS[sport].path}/scoreboard?dates=${date}&limit=400${group}`);
      const games = (d.events ?? []).map((e) => parseEvent(sport, e));
      await upsertGames(games);
      n += games.length;
    }
  }
  return { sports: active.length, games: n };
}

type GameRow = {
  event_id: string; sport: SportKey; starts_at: string; state: Game["state"]; status_name: string; completed: boolean;
  period: number | null; clock: string | null; detail: string; home_name: string; away_name: string;
  home_abbr: string; away_abbr: string; home_espn_id: string; away_espn_id: string;
  home_school_id: string | null; away_school_id: string | null; home_score: number | null; away_score: number | null;
  winner_side: "home" | "away" | null; overtime: boolean | null; ou_line: number | null;
};

const shortOf = (name: string, schoolId: string | null) =>
  UNIVERSITIES.find((u) => u.school_id === schoolId)?.short_name || name.split(" ").slice(0, -1).join(" ") || name;

/** Rebuild the Game the core functions expect from a stored row. */
export function rowToGame(r: GameRow): Game {
  const side = (h: "home" | "away") => ({
    espnId: r[`${h}_espn_id`],
    name: r[`${h}_name`],
    short: shortOf(r[`${h}_name`], r[`${h}_school_id`]),
    abbr: r[`${h}_abbr`],
    schoolId: r[`${h}_school_id`],
    score: r[`${h}_score`],
    winner: r.winner_side == null ? null : r.winner_side === h,
  });
  return {
    eventId: r.event_id, sport: r.sport, startsAt: new Date(r.starts_at).toISOString(), state: r.state,
    statusName: r.status_name, completed: r.completed, period: r.period, clock: r.clock, detail: r.detail,
    home: side("home"), away: side("away"), winnerSide: r.winner_side, overtime: Boolean(r.overtime), ouLine: r.ou_line,
  };
}

async function insertMarket(c: PoolClient, g: Game, spec: ReturnType<typeof marketsForGame>[number], odds: Odds) {
  const marketId = `m-sp-${g.eventId}-${spec.kind}`;
  const pFocus = spec.focus === "home" ? odds.pHome : 1 - odds.pHome;
  const q = sharesForProbs(openingProbs(spec.kind, g.sport, pFocus), LIQUIDITY_B);
  const inserted = await c.query(
    `INSERT INTO markets (market_id, school_id, course, question, market_type, status, liquidity_b, creator_id,
       resolution_source, opens_at, closes_at, category, sport, event_ref, market_kind, line, auto_resolve, opening_note)
     VALUES ($1,$2,$3,$4,$5,'live',$6,$7,$8,now(),$9,'sports',$10,$11,$12,$13,true,$14)
     ON CONFLICT DO NOTHING RETURNING market_id`,
    [
      marketId, spec.schoolId, SPORTS[g.sport].label, spec.question, spec.outcomes.length === 2 ? "binary" : "multiple_choice",
      LIQUIDITY_B, SPORTS_BOT, `ESPN final score (event ${g.eventId})`, closesAt(spec.kind, g.sport, g.startsAt), g.sport,
      g.eventId, spec.kind, spec.line, openingNote(spec.kind, pFocus, odds.source, g.sport),
    ],
  );
  if (!inserted.rowCount) return false;
  await c.query(
    `INSERT INTO outcomes (market_id, outcome_index, label, q_shares)
     SELECT $1, i - 1, label, q FROM unnest($2::text[], $3::float8[]) WITH ORDINALITY AS x(label, q, i)`,
    [marketId, spec.outcomes, q],
  );
  return true;
}

// ------------------------------------------------------------------ real-world odds
type Odds = { pHome: number; source: "espn" | "rating" | "even" };

/** ESPN game summary: pre-game matchup predictor and live win probability (football + basketball only). */
async function espnSummary(sport: SportKey, eventId: string): Promise<{ predictorHome: number | null; liveHome: number | null }> {
  const d = await espn<{ predictor?: { homeTeam?: { gameProjection?: string } }; winprobability?: { homeWinPercentage?: number }[] }>(
    `${SPORTS[sport].path}/summary?event=${eventId}`,
  );
  const pred = Number(d.predictor?.homeTeam?.gameProjection);
  const live = d.winprobability?.at(-1)?.homeWinPercentage;
  return { predictorHome: Number.isFinite(pred) && pred > 0 ? pred / 100 : null, liveHome: typeof live === "number" ? live : null };
}

/** Home team's chance to win before the game: ESPN's predictor, else season margins, else a coin flip. */
async function homeWinOdds(g: Game): Promise<Odds> {
  if (SPORTS[g.sport].liveOdds) {
    const s = await espnSummary(g.sport, g.eventId).catch(() => null);
    if (s?.predictorHome != null) return { pHome: s.predictorHome, source: "espn" };
  }
  const margins = await q<{ espn_id: string; avg: number; n: number }>(
    `SELECT t.espn_id, avg(t.m)::float AS avg, count(*)::int AS n FROM (
       SELECT home_espn_id AS espn_id, home_score - away_score AS m FROM sports_games
         WHERE sport = $1 AND completed AND starts_at > now() - interval '300 days' AND home_espn_id IN ($2, $3)
       UNION ALL
       SELECT away_espn_id, away_score - home_score FROM sports_games
         WHERE sport = $1 AND completed AND starts_at > now() - interval '300 days' AND away_espn_id IN ($2, $3)) t
     GROUP BY t.espn_id`,
    [g.sport, g.home.espnId, g.away.espnId],
  );
  const m = new Map(margins.filter((r) => r.n >= 2).map((r) => [r.espn_id, r.avg]));
  if (!m.has(g.home.espnId) && !m.has(g.away.espnId)) return { pHome: 0.5, source: "even" };
  return { pHome: ratingWinProb(g.sport, m.get(g.home.espnId) ?? 0, m.get(g.away.espnId) ?? 0), source: "rating" };
}

function openingNote(kind: MarketKind, pFocus: number, source: Odds["source"], sport: SportKey): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const from = source === "espn" ? "ESPN's matchup predictor" : source === "rating" ? "both teams' results this season" : "no data yet, so even";
  switch (kind) {
    case "winner": return `Opened at ${pct(pFocus)} from ${from}.`;
    case "margin": return `Opened from ${from} (${pct(pFocus)} to win), spread across margins.`;
    case "overtime": return `Opened at ${pct(SPORTS[sport].overtimeRate)}, how often ${SPORTS[sport].label.toLowerCase()} games go to overtime.`;
    case "total": return "Opened at 50%: the line is the two teams' average combined total this season.";
  }
}

/** Existing sports markets that opened at 50/50 before real odds existed: seed them if nobody has traded yet. */
export async function seedUntouched(limitGames = 25) {
  const rows = await q<GameRow>(
    `SELECT DISTINCT ON (g.event_id) g.* FROM sports_games g JOIN markets m ON m.event_ref = g.event_id
     WHERE m.category = 'sports' AND m.status = 'live' AND m.opening_note IS NULL AND g.state = 'pre'
       AND NOT EXISTS (SELECT 1 FROM trades t WHERE t.market_id = m.market_id)
     ORDER BY g.event_id LIMIT $1`,
    [limitGames],
  );
  let seeded = 0;
  for (const r of rows) {
    const g = rowToGame(r);
    const odds = await homeWinOdds(g);
    const ms = await q<{ market_id: string; market_kind: MarketKind; liquidity_b: number }>(
      `SELECT m.market_id, m.market_kind, m.liquidity_b FROM markets m
       WHERE m.event_ref = $1 AND m.opening_note IS NULL AND NOT EXISTS (SELECT 1 FROM trades t WHERE t.market_id = m.market_id)`,
      [g.eventId],
    );
    for (const m of ms) {
      const focus = g.home.schoolId ? "home" : "away";
      const pFocus = focus === "home" ? odds.pHome : 1 - odds.pHome;
      const qs = sharesForProbs(openingProbs(m.market_kind, g.sport, pFocus), m.liquidity_b);
      await tx(async (c) => {
        await c.query(
          `UPDATE outcomes o SET q_shares = x.q FROM unnest($2::float8[]) WITH ORDINALITY AS x(q, i)
           WHERE o.market_id = $1 AND o.outcome_index = x.i - 1`,
          [m.market_id, qs],
        );
        await c.query("UPDATE markets SET opening_note = $2, closes_at = $3 WHERE market_id = $1", [
          m.market_id, openingNote(m.market_kind, pFocus, odds.source, g.sport), closesAt(m.market_kind, g.sport, g.startsAt),
        ]);
      });
      seeded++;
    }
  }
  return seeded;
}

/**
 * Live games (football/basketball): re-anchor each winner market to ESPN's live win probability, like a market
 * maker updating its quote, so nobody can buy a stale price after a touchdown. Traders keep their shares.
 */
export async function anchorLive() {
  const rows = await q<GameRow & { market_id: string; liquidity_b: number; q: number[] }>(
    `SELECT g.*, m.market_id, m.liquidity_b,
            (SELECT array_agg(o.q_shares ORDER BY o.outcome_index) FROM outcomes o WHERE o.market_id = m.market_id) AS q
     FROM sports_games g JOIN markets m ON m.event_ref = g.event_id AND m.market_kind = 'winner'
     WHERE g.state = 'in' AND m.status = 'live' AND m.closes_at > now()`,
  );
  let anchored = 0;
  for (const r of rows) {
    const g = rowToGame(r);
    if (!SPORTS[g.sport].liveOdds) continue;
    const s = await espnSummary(g.sport, g.eventId).catch(() => null);
    if (s?.liveHome == null) continue;
    const focusHome = Boolean(g.home.schoolId);
    const target = focusHome ? s.liveHome : 1 - s.liveHome;
    const current = prices(r.q, r.liquidity_b)[0];
    if (Math.abs(current - target) < 0.01) continue;
    const qs = sharesForProbs([target, 1 - target], r.liquidity_b);
    await tx(async (c) => {
      // Lock order matches trades: market row first, then outcomes.
      await c.query("SELECT 1 FROM markets WHERE market_id = $1 FOR UPDATE", [r.market_id]);
      await c.query(
        `UPDATE outcomes o SET q_shares = x.q FROM unnest($2::float8[]) WITH ORDINALITY AS x(q, i)
         WHERE o.market_id = $1 AND o.outcome_index = x.i - 1`,
        [r.market_id, qs],
      );
    });
    anchored++;
  }
  return anchored;
}

/** Markets for upcoming games (next CREATE_AHEAD_DAYS days), opened at real-world odds. See closesAt for when each trades until. */
export async function createMarkets() {
  const rows = await q<GameRow>(
    `SELECT g.* FROM sports_games g
     WHERE g.state = 'pre' AND g.starts_at > now() + interval '10 minutes'
       AND g.starts_at < now() + interval '${CREATE_AHEAD_DAYS} days'
       AND NOT EXISTS (SELECT 1 FROM markets m WHERE m.event_ref = g.event_id)`,
  );
  let created = 0;
  for (const r of rows) {
    const g = rowToGame(r);
    // Over/under line: ESPN's if it ever sends one, else these two teams' average combined total this season.
    const past = await q<{ total: number }>(
      `SELECT (home_score + away_score)::float AS total FROM sports_games
       WHERE sport = $1 AND completed AND home_score IS NOT NULL AND starts_at > now() - interval '300 days'
         AND (home_espn_id IN ($2, $3) OR away_espn_id IN ($2, $3))`,
      [g.sport, g.home.espnId, g.away.espnId],
    );
    const line = g.ouLine != null ? Math.floor(g.ouLine) + 0.5 : totalLine(g.sport, past.map((p) => p.total));
    const odds = await homeWinOdds(g);
    await tx(async (c) => {
      for (const spec of marketsForGame(g, line)) if (await insertMarket(c, g, spec, odds)) created++;
    });
  }
  return created;
}

/**
 * Games already in progress with no markets (e.g. kicked off before Yomi created them): football and basketball
 * get a winner market opened at ESPN's live win probability, so they can be bet on immediately. Totals, margins
 * and hockey/volleyball are skipped mid-game: without live odds their opening price would be stale.
 */
export async function createLiveMarkets() {
  const rows = await q<GameRow>(
    `SELECT g.* FROM sports_games g
     WHERE g.state = 'in' AND g.sport IN ('football', 'mens-basketball', 'womens-basketball')
       AND (g.home_school_id IS NOT NULL OR g.away_school_id IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM markets m WHERE m.event_ref = g.event_id AND m.market_kind = 'winner')`,
  );
  let created = 0;
  for (const r of rows) {
    const g = rowToGame(r);
    const s = await espnSummary(g.sport, g.eventId).catch(() => null);
    if (s?.liveHome == null) continue; // no live probability yet: wait for the next pass
    const spec = marketsForGame(g, SPORTS[g.sport].defaultTotal).find((x) => x.kind === "winner");
    if (!spec) continue;
    const pFocus = spec.focus === "home" ? s.liveHome : 1 - s.liveHome;
    const marketId = `m-sp-${g.eventId}-winner`;
    await tx(async (c) => {
      const ins = await c.query(
        `INSERT INTO markets (market_id, school_id, course, question, market_type, status, liquidity_b, creator_id,
           resolution_source, opens_at, closes_at, category, sport, event_ref, market_kind, auto_resolve, opening_note)
         VALUES ($1,$2,$3,$4,'binary','live',$5,$6,$7,now(),$8,'sports',$9,$10,'winner',true,$11)
         ON CONFLICT DO NOTHING RETURNING market_id`,
        [
          marketId, spec.schoolId, SPORTS[g.sport].label, spec.question, LIQUIDITY_B, SPORTS_BOT,
          `ESPN final score (event ${g.eventId})`, closesAt("winner", g.sport, g.startsAt), g.sport, g.eventId,
          `Opened mid-game (${g.detail}) at ${Math.round(pFocus * 100)}% from ESPN's live win probability.`,
        ],
      );
      if (!ins.rowCount) return;
      const qs = sharesForProbs([pFocus, 1 - pFocus], LIQUIDITY_B);
      await c.query(`INSERT INTO outcomes (market_id, outcome_index, label, q_shares) VALUES ($1,0,'Yes',$2), ($1,1,'No',$3)`, [marketId, qs[0], qs[1]]);
      created++;
    });
  }
  return created;
}

/** Settle auto-resolve sports markets whose game is final (or voided). */
export async function settleFinished() {
  const rows = await q<GameRow & { market_id: string; market_kind: "winner" | "total" | "margin" | "overtime"; line: number | null }>(
    `SELECT g.*, m.market_id, m.market_kind, m.line FROM markets m JOIN sports_games g ON g.event_id = m.event_ref
     WHERE m.category = 'sports' AND m.auto_resolve AND m.status IN ('live', 'closed')
       AND ((g.state = 'post' AND g.completed)
            OR g.status_name IN ('STATUS_POSTPONED','STATUS_CANCELED','STATUS_FORFEIT','STATUS_ABANDONED','STATUS_SUSPENDED'))`,
  );
  let settled = await settleEarly();
  for (const r of rows) {
    const g = rowToGame(r);
    const focus = g.home.schoolId ? "home" : "away"; // same rule marketsForGame used when creating
    const winner = resolveOutcome({ kind: r.market_kind, line: r.line, focus }, g);
    if (winner == null) continue;
    const why = winner === "void" ? `Voided: ${g.detail || g.statusName} (ESPN)` : `${scoreLine(g)} (ESPN, auto-resolved)`;
    try {
      await settleMarket(r.market_id, winner, why, SPORTS_BOT);
      settled++;
    } catch (e) {
      console.warn("[sports] settle", r.market_id, String(e).slice(0, 200));
    }
  }
  return settled;
}

/** Mid-game: over/under is settled Over once the line is passed; overtime is settled Yes once OT starts. */
async function settleEarly() {
  const rows = await q<GameRow & { market_id: string; market_kind: MarketKind; line: number | null }>(
    `SELECT g.*, m.market_id, m.market_kind, m.line FROM markets m JOIN sports_games g ON g.event_id = m.event_ref
     WHERE m.category = 'sports' AND m.auto_resolve AND m.status IN ('live', 'closed') AND g.state = 'in'
       AND m.market_kind IN ('total', 'overtime')`,
  );
  let n = 0;
  for (const r of rows) {
    const g = rowToGame(r);
    const winner = decidedEarly({ kind: r.market_kind, line: r.line }, g);
    if (winner == null) continue;
    const why = r.market_kind === "total" ? `Over locked in mid-game: ${scoreLine(g)} (ESPN)` : `Went to overtime: ${scoreLine(g)} (ESPN)`;
    await settleMarket(r.market_id, winner, why, SPORTS_BOT).then(() => n++).catch((e) => console.warn("[sports] early", String(e).slice(0, 150)));
  }
  return n;
}

// ------------------------------------------------------------------ reads for the UI / API
/** pg returns timestamptz as Date; the UI and JSON want ISO strings. */
const iso = (v: string | Date) => new Date(v).toISOString();
export type GameMarket = {
  market_id: string;
  market_kind: string;
  status: string;
  open: boolean; // live and before its close (kickoff, or the final whistle for live-trading markets)
  outcomes: { label: string; price: number }[];
};
export type SportsGame = GameRow & { score_line: string; markets: GameMarket[] };

type RawGameMarket = Omit<GameMarket, "outcomes"> & { liquidity_b: number; outcomes: { label: string; q: number }[] };
const priced = (m: RawGameMarket): GameMarket => {
  const p = prices(m.outcomes.map((o) => o.q), m.liquidity_b);
  return { market_id: m.market_id, market_kind: m.market_kind, status: m.status, open: m.open, outcomes: m.outcomes.map((o, i) => ({ label: o.label, price: p[i] })) };
};

export async function listGames(opts: { sport?: string; school?: string; days?: number } = {}): Promise<SportsGame[]> {
  const rows = await q<GameRow & { markets: RawGameMarket[] | null }>(
    `SELECT g.*, (SELECT json_agg(json_build_object('market_id', m.market_id, 'market_kind', m.market_kind, 'status', m.status,
                                    'open', m.status = 'live' AND m.closes_at > now(), 'liquidity_b', m.liquidity_b,
                                    'outcomes', (SELECT json_agg(json_build_object('label', o.label, 'q', o.q_shares) ORDER BY o.outcome_index)
                                                 FROM outcomes o WHERE o.market_id = m.market_id))
                                  ORDER BY array_position(ARRAY['winner','total','margin','overtime'], m.market_kind))
                  FROM markets m WHERE m.event_ref = g.event_id) AS markets
     FROM sports_games g
     WHERE g.starts_at > now() - interval '3 days' AND g.starts_at < now() + make_interval(days => $3)
       AND ($1::text IS NULL OR g.sport = $1) AND ($2::text IS NULL OR $2 IN (g.home_school_id, g.away_school_id))
     ORDER BY (g.state = 'in') DESC, abs(extract(epoch FROM g.starts_at - now())) LIMIT 200`,
    [opts.sport ?? null, opts.school ?? null, opts.days ?? 7],
  );
  return rows.map((r) => ({ ...r, starts_at: iso(r.starts_at), markets: (r.markets ?? []).map(priced), score_line: scoreLine(rowToGame(r)) }));
}

export async function getGame(eventId: string): Promise<SportsGame | null> {
  const rows = await q<GameRow>("SELECT * FROM sports_games WHERE event_id = $1", [eventId]);
  return rows[0] ? { ...rows[0], starts_at: iso(rows[0].starts_at), markets: [], score_line: scoreLine(rowToGame(rows[0])) } : null;
}
