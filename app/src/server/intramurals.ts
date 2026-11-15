import "server-only";
import { AUTO_CONFIRM_HOURS, chicagoToIso, denyReason, parseSchedule, validScore, winnerOutcome, type Action, type ImStatus } from "@/core/intramurals";
import { q, tx } from "./ledger";
import { isAdmin, settleMarket, TradeError } from "./markets";

/**
 * Intramurals. FusionPlay (UW Rec Well's league app) has no public data or API, so admins import the schedule
 * (CSV copied from FusionPlay) and captains report results; the opposing captain confirms, which auto-resolves
 * the game's market. Unconfirmed reports auto-confirm after AUTO_CONFIRM_HOURS. Disputes go to admins.
 */
export const IM_BOT = "u-yomi-im";
type Admin = { user_id: string; email: string; school_id: string };
const requireAdmin = (u: Admin) => {
  if (!isAdmin(u)) throw new TradeError("Only admins can manage intramural leagues.", 403);
};

export type ImGameRow = {
  game_id: string; league_id: string; sport: string; season: string; division: string | null;
  starts_at: string; location: string | null; status: ImStatus; home_score: number | null; away_score: number | null;
  home_team_id: string; away_team_id: string; home_name: string; away_name: string;
  home_captain: string | null; away_captain: string | null; home_captain_handle: string | null; away_captain_handle: string | null;
  reported_by: string | null; reported_at: string | null; dispute_note: string | null; market_id: string | null;
};

const GAME_SQL = `
  SELECT g.game_id, g.league_id, l.sport, l.season, l.division, g.starts_at, g.location, g.status, g.home_score,
         g.away_score, g.home_team_id, g.away_team_id, ht.name AS home_name, at.name AS away_name,
         ht.captain_user_id AS home_captain, at.captain_user_id AS away_captain,
         hu.handle AS home_captain_handle, au.handle AS away_captain_handle,
         g.reported_by, g.reported_at, g.dispute_note,
         (SELECT m.market_id FROM markets m WHERE m.event_ref = 'im:' || g.game_id LIMIT 1) AS market_id
  FROM im_games g JOIN im_leagues l USING (league_id)
  JOIN im_teams ht ON ht.team_id = g.home_team_id JOIN im_teams at ON at.team_id = g.away_team_id
  LEFT JOIN users hu ON hu.user_id = ht.captain_user_id LEFT JOIN users au ON au.user_id = at.captain_user_id`;

/** pg returns timestamptz as Date; normalize to ISO strings for the UI and the pure rules. */
const norm = (r: ImGameRow): ImGameRow => ({
  ...r,
  starts_at: new Date(r.starts_at).toISOString(),
  reported_at: r.reported_at ? new Date(r.reported_at).toISOString() : null,
});

export async function getGame(gameId: string): Promise<ImGameRow | null> {
  const r = (await q<ImGameRow>(`${GAME_SQL} WHERE g.game_id = $1`, [gameId]))[0];
  return r ? norm(r) : null;
}

export async function listGames(leagueId?: string): Promise<ImGameRow[]> {
  return (await q<ImGameRow>(`${GAME_SQL} WHERE ($1::text IS NULL OR g.league_id = $1) ORDER BY g.starts_at LIMIT 300`, [leagueId ?? null])).map(norm);
}

export type League = { league_id: string; school_id: string; sport: string; season: string; division: string | null; teams: number; games: number };
export async function listLeagues(): Promise<League[]> {
  return q<League>(
    `SELECT l.league_id, l.school_id, l.sport, l.season, l.division,
            (SELECT count(*)::int FROM im_teams t WHERE t.league_id = l.league_id) AS teams,
            (SELECT count(*)::int FROM im_games g WHERE g.league_id = l.league_id) AS games
     FROM im_leagues l ORDER BY l.created_at DESC`,
  );
}

export type Standing = { team_id: string; name: string; w: number; l: number; t: number; captain_handle: string | null };
export async function standings(leagueId: string): Promise<Standing[]> {
  return q<Standing>(
    `SELECT t.team_id, t.name, u.handle AS captain_handle,
       count(*) FILTER (WHERE (g.home_team_id = t.team_id AND g.home_score > g.away_score) OR (g.away_team_id = t.team_id AND g.away_score > g.home_score))::int AS w,
       count(*) FILTER (WHERE (g.home_team_id = t.team_id AND g.home_score < g.away_score) OR (g.away_team_id = t.team_id AND g.away_score < g.home_score))::int AS l,
       count(*) FILTER (WHERE g.home_score = g.away_score)::int AS t
     FROM im_teams t LEFT JOIN users u ON u.user_id = t.captain_user_id
     LEFT JOIN im_games g ON t.team_id IN (g.home_team_id, g.away_team_id) AND g.status IN ('final', 'forfeit')
     WHERE t.league_id = $1 GROUP BY t.team_id, t.name, u.handle ORDER BY w DESC, l ASC, t.name`,
    [leagueId],
  );
}

// ------------------------------------------------------------------ admin setup
export async function createLeague(admin: Admin, input: { sport?: string; season?: string; division?: string }) {
  requireAdmin(admin);
  const sport = String(input.sport ?? "").trim().slice(0, 40);
  const season = String(input.season ?? "").trim().slice(0, 40);
  if (!sport || !season) throw new TradeError("League needs a sport and a season (e.g. Basketball, Fall 2026).");
  const leagueId = `iml-${crypto.randomUUID().slice(0, 8)}`;
  await q(`INSERT INTO im_leagues (league_id, school_id, sport, season, division, created_by) VALUES ($1,$2,$3,$4,$5,$6)`, [
    leagueId, admin.school_id, sport, season, String(input.division ?? "").trim().slice(0, 40) || null, admin.user_id,
  ]);
  return { leagueId };
}

/** Import games from CSV (date,time,home,away,location; Central time). Creates teams and each game's market. */
export async function importGames(admin: Admin, leagueId: string, csv: string) {
  requireAdmin(admin);
  const league = (await q<{ sport: string; school_id: string }>("SELECT sport, school_id FROM im_leagues WHERE league_id = $1", [leagueId]))[0];
  if (!league) throw new TradeError("League not found.", 404);
  const { rows, errors } = parseSchedule(csv);
  if (!rows.length) throw new TradeError(errors[0] ?? "Paste at least one game: date,time,home,away,location");
  let created = 0;
  await tx(async (c) => {
    const teamId = async (name: string) => {
      const r = await c.query(
        `INSERT INTO im_teams (team_id, league_id, name) VALUES ($1, $2, $3)
         ON CONFLICT (league_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING team_id`,
        [`imt-${crypto.randomUUID().slice(0, 8)}`, leagueId, name],
      );
      return r.rows[0].team_id as string;
    };
    for (const r of rows) {
      const [home, away] = [await teamId(r.home), await teamId(r.away)];
      const startsAt = chicagoToIso(r.date, r.time);
      const gameId = `img-${crypto.randomUUID().slice(0, 8)}`;
      await c.query(
        `INSERT INTO im_games (game_id, league_id, home_team_id, away_team_id, starts_at, location) VALUES ($1,$2,$3,$4,$5,$6)`,
        [gameId, leagueId, home, away, startsAt, r.location],
      );
      // Winner market, trading closes at the scheduled start.
      const marketId = `m-im-${gameId}`;
      const day = new Date(startsAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
      if (Date.parse(startsAt) > Date.now() + 5 * 60e3) {
        await c.query(
          `INSERT INTO markets (market_id, school_id, course, question, market_type, status, liquidity_b, creator_id,
             resolution_source, opens_at, closes_at, category, sport, event_ref, market_kind, auto_resolve)
           VALUES ($1,$2,$3,$4,'binary','live',200,$5,$6,now(),$7,'intramural',$8,$9,'winner',true)`,
          [marketId, league.school_id, `IM ${league.sport}`, `IM ${league.sport}: Will ${r.home} beat ${r.away}? (${day})`,
           IM_BOT, "Captain-reported score, confirmed by the other captain (FusionPlay)", startsAt, league.sport, `im:${gameId}`],
        );
        await c.query(`INSERT INTO outcomes (market_id, outcome_index, label, q_shares) VALUES ($1,0,'Yes',0), ($1,1,'No',0)`, [marketId]);
      }
      created++;
    }
  });
  return { created, errors };
}

/** Assign a team's captain by their Yomi email (they must have signed in once). */
export async function setCaptain(admin: Admin, teamId: string, email: string) {
  requireAdmin(admin);
  const u = (await q<{ user_id: string; handle: string }>("SELECT user_id, handle FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL", [
    String(email ?? "").trim(),
  ]))[0];
  if (!u) throw new TradeError("No Yomi account with that email yet. They need to sign in once first.", 404);
  const r = await q("UPDATE im_teams SET captain_user_id = $2 WHERE team_id = $1 RETURNING team_id", [teamId, u.user_id]);
  if (!r.length) throw new TradeError("Team not found.", 404);
  return { captain: u.handle };
}

// ------------------------------------------------------------------ captain flow
async function settleGame(gameId: string, why: string) {
  const g = await getGame(gameId);
  if (!g?.market_id) return;
  const winner = winnerOutcome(g.status, g.home_score, g.away_score);
  const note = winner === "void" ? `Voided: ${g.status === "canceled" ? "game canceled" : "tie"}. ${why}` : `${g.home_name} ${g.home_score} – ${g.away_name} ${g.away_score}. ${why}`;
  try {
    await settleMarket(g.market_id, winner, note, IM_BOT);
  } catch (e) {
    if (!(e instanceof TradeError && e.status === 409)) throw e; // already settled is fine
  }
}

async function act(userId: string, gameId: string, action: Action) {
  const g = await getGame(gameId);
  if (!g) throw new TradeError("Game not found.", 404);
  const why = denyReason(g, userId, action);
  if (why) throw new TradeError(why, 403);
  return g;
}

export async function reportScore(userId: string, gameId: string, home: unknown, away: unknown) {
  if (!validScore(home) || !validScore(away)) throw new TradeError("Scores must be whole numbers.");
  await act(userId, gameId, "report");
  await q(
    `UPDATE im_games SET status = 'reported', home_score = $2, away_score = $3, reported_by = $4, reported_at = now(),
       dispute_note = NULL WHERE game_id = $1 AND status IN ('scheduled', 'reported')`,
    [gameId, home, away, userId],
  );
  return { status: "reported", autoConfirmsInHours: AUTO_CONFIRM_HOURS };
}

export async function confirmScore(userId: string, gameId: string) {
  await act(userId, gameId, "confirm");
  const r = await q("UPDATE im_games SET status = 'final', confirmed_by = $2, confirmed_at = now() WHERE game_id = $1 AND status = 'reported' RETURNING game_id", [gameId, userId]);
  if (r.length) await settleGame(gameId, "Confirmed by both captains.");
  return { status: "final" };
}

export async function disputeScore(userId: string, gameId: string, note: unknown) {
  await act(userId, gameId, "dispute");
  await q(
    "UPDATE im_games SET status = 'disputed', disputed_by = $2, disputed_at = now(), dispute_note = $3 WHERE game_id = $1 AND status = 'reported'",
    [gameId, userId, String(note ?? "").trim().slice(0, 500) || null],
  );
  return { status: "disputed" };
}

/** Admin decision: final score, forfeit (winner side), or canceled. Settles the market. */
export async function adminResult(admin: Admin, gameId: string, input: { home?: unknown; away?: unknown; forfeit?: "home" | "away"; canceled?: boolean }) {
  requireAdmin(admin);
  const g = await getGame(gameId);
  if (!g) throw new TradeError("Game not found.", 404);
  if (["final", "forfeit", "canceled"].includes(g.status)) throw new TradeError(`This game is already ${g.status}.`, 409);
  if (input.canceled) {
    await q("UPDATE im_games SET status = 'canceled' WHERE game_id = $1", [gameId]);
  } else if (input.forfeit) {
    const [h, a] = input.forfeit === "home" ? [1, 0] : [0, 1]; // the team that showed up wins
    await q("UPDATE im_games SET status = 'forfeit', home_score = $2, away_score = $3, confirmed_by = $4, confirmed_at = now() WHERE game_id = $1", [gameId, h, a, admin.user_id]);
  } else {
    if (!validScore(input.home) || !validScore(input.away)) throw new TradeError("Scores must be whole numbers.");
    await q("UPDATE im_games SET status = 'final', home_score = $2, away_score = $3, confirmed_by = $4, confirmed_at = now() WHERE game_id = $1", [gameId, input.home, input.away, admin.user_id]);
  }
  await settleGame(gameId, "Decided by an admin.");
  return { ok: true };
}

/** Poller: reports nobody confirmed or disputed within AUTO_CONFIRM_HOURS become final. */
export async function autoConfirmDue(): Promise<number> {
  const due = await q<{ game_id: string }>(
    `UPDATE im_games SET status = 'final', confirmed_at = now()
     WHERE status = 'reported' AND reported_at < now() - make_interval(hours => $1) RETURNING game_id`,
    [AUTO_CONFIRM_HOURS],
  );
  for (const d of due) await settleGame(d.game_id, `Auto-confirmed after ${AUTO_CONFIRM_HOURS}h with no dispute.`);
  return due.length;
}

export type ImTeam = { team_id: string; league_id: string; name: string; captain_handle: string | null };
export async function listTeams(leagueId: string): Promise<ImTeam[]> {
  return q<ImTeam>(
    "SELECT t.team_id, t.league_id, t.name, u.handle AS captain_handle FROM im_teams t LEFT JOIN users u ON u.user_id = t.captain_user_id WHERE t.league_id = $1 ORDER BY t.name",
    [leagueId],
  );
}

export async function disputedGames(): Promise<ImGameRow[]> {
  return (await q<ImGameRow>(`${GAME_SQL} WHERE g.status = 'disputed' ORDER BY g.disputed_at`)).map(norm);
}
