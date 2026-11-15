import Link from "next/link";
import { Suspense } from "react";
import { AdminResultForm, CaptainForm, ImportForm, NewLeagueForm } from "@/components/im-forms";
import { currentUser } from "@/server/auth";
import { disputedGames, listGames, listLeagues, listTeams, standings, type ImGameRow } from "@/server/intramurals";
import { isAdmin } from "@/server/markets";

export default function IntramuralsPage({ searchParams }: PageProps<"/intramurals">) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-bold">Intramurals</h1>
        <p className="text-muted">
          UW Rec Well intramural leagues. Every game gets a winner market that closes at tip-off. After the game, one captain
          reports the score and the other confirms, which resolves the market (or it auto-confirms after 2 hours with no
          dispute). Captains can&apos;t trade their own team&apos;s games.
        </p>
      </div>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl border border-line bg-panel" />}>
        <Board searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });

async function Board({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const [leagues, user] = await Promise.all([listLeagues(), currentUser()]);
  const admin = user ? isAdmin(user) : false;
  const leagueId = typeof sp.league === "string" && leagues.some((l) => l.league_id === sp.league) ? sp.league : leagues[0]?.league_id;
  const [table, games, teams, disputes] = leagueId
    ? await Promise.all([standings(leagueId), listGames(leagueId), admin ? listTeams(leagueId) : Promise.resolve([]), admin ? disputedGames() : Promise.resolve([])])
    : [[], [], [], admin ? await disputedGames() : []];

  return (
    <>
      {leagues.length > 0 && (
        <nav className="flex flex-wrap gap-1.5 text-sm">
          {leagues.map((l) => (
            <Link key={l.league_id} href={`/intramurals?league=${l.league_id}`} className={`rounded-lg px-3 py-1.5 font-medium ${l.league_id === leagueId ? "bg-accent text-accent-ink" : "bg-panel text-muted hover:text-ink"}`}>
              {l.sport} · {l.season}
              {l.division ? ` · ${l.division}` : ""}
            </Link>
          ))}
        </nav>
      )}
      {leagues.length === 0 && (
        <p className="rounded-2xl border border-line bg-panel p-8 text-center text-muted">
          No intramural leagues yet. {admin ? "Create one below and import its schedule from FusionPlay." : "Admins add leagues from the FusionPlay schedule."}
        </p>
      )}

      {leagueId && (
        <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
          <section className="overflow-hidden rounded-2xl border border-line bg-panel">
            <h2 className="px-4 py-3 font-semibold">Standings</h2>
            <table className="w-full text-sm">
              <thead className="bg-panel-2 text-left text-xs text-muted">
                <tr><th className="px-4 py-2">Team</th><th className="text-right">W</th><th className="text-right">L</th><th className="px-4 text-right">T</th></tr>
              </thead>
              <tbody className="tabular">
                {table.map((t) => (
                  <tr key={t.team_id} className="border-t border-line">
                    <td className="px-4 py-2">{t.name}{t.captain_handle && <span className="block text-xs text-muted">capt. @{t.captain_handle}</span>}</td>
                    <td className="text-right font-semibold">{t.w}</td><td className="text-right">{t.l}</td><td className="px-4 text-right">{t.t}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="rounded-2xl border border-line bg-panel p-4">
            <h2 className="mb-2 font-semibold">Schedule</h2>
            <ul className="divide-y divide-line">
              {games.map((g) => <GameRow key={g.game_id} g={g} />)}
              {!games.length && <li className="py-6 text-center text-sm text-muted">No games imported yet.</li>}
            </ul>
          </section>
        </div>
      )}

      {admin && (
        <section className="space-y-4 rounded-2xl border border-accent/40 bg-panel p-4">
          <h2 className="font-semibold">Admin: league setup</h2>
          <div><h3 className="mb-1 text-sm font-semibold">New league</h3><NewLeagueForm /></div>
          {leagueId && (
            <>
              <div><h3 className="mb-1 text-sm font-semibold">Import games into this league</h3><ImportForm leagueId={leagueId} /></div>
              <div><h3 className="mb-1 text-sm font-semibold">Captains</h3><CaptainForm teams={teams} /></div>
            </>
          )}
          <div>
            <h3 className="mb-1 text-sm font-semibold">Disputed results {disputes.length > 0 && <span className="text-no">({disputes.length})</span>}</h3>
            {disputes.length === 0 && <p className="text-sm text-muted">None.</p>}
            <ul className="space-y-3">
              {disputes.map((g) => (
                <li key={g.game_id} className="rounded-lg border border-no/40 p-3 text-sm">
                  <Link href={`/intramurals/${g.game_id}`} className="font-semibold hover:underline">{g.away_name} at {g.home_name}</Link>{" "}
                  · reported {g.away_score}–{g.home_score}
                  {g.dispute_note && <p className="mt-1 text-muted">&ldquo;{g.dispute_note}&rdquo;</p>}
                  <div className="mt-2"><AdminResultForm gameId={g.game_id} /></div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </>
  );
}

function GameRow({ g }: { g: ImGameRow }) {
  const done = ["final", "forfeit"].includes(g.status);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">
      <span className="w-40 text-xs text-muted">{when(g.starts_at)}{g.location ? ` · ${g.location}` : ""}</span>
      <Link href={`/intramurals/${g.game_id}`} className="flex-1 font-medium hover:underline">
        {g.away_name} <span className="text-muted">at</span> {g.home_name}
      </Link>
      <span className="tabular w-16 text-right font-semibold">{g.home_score != null ? `${g.away_score}–${g.home_score}` : ""}</span>
      <span className={`w-20 text-right text-xs font-semibold ${g.status === "disputed" ? "text-no" : done ? "text-yes" : "text-muted"}`}>{g.status}</span>
      {g.market_id && <Link href={`/markets/${g.market_id}`} className="rounded-md bg-accent-soft px-2 py-1 text-xs font-semibold text-accent">Market</Link>}
    </li>
  );
}
