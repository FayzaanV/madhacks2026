import Link from "next/link";
import { Suspense } from "react";
import { SPORTS, type SportKey } from "@/core/sports";
import { UNIVERSITIES } from "@/core/universities";
import { listGames, type SportsGame } from "@/server/sports";

const KIND_LABEL: Record<string, string> = { winner: "Winner", total: "Over/under", margin: "Margin", overtime: "Overtime" };
const BIG_TEN = UNIVERSITIES.filter((u) => u.conference === "big-ten").sort((a, b) => a.short_name.localeCompare(b.short_name));

export default function SportsPage({ searchParams }: PageProps<"/sports">) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-bold">Big Ten sports</h1>
        <p className="text-muted">
          Live scores from ESPN. Every game involving a Big Ten school gets winner, over/under, margin and overtime markets
          that close at the start and resolve themselves at the final whistle. Team markets only, never individual players.
        </p>
      </div>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl border border-line bg-panel" />}>
        <Board searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Board({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const sport = typeof sp.sport === "string" && sp.sport in SPORTS ? (sp.sport as SportKey) : undefined;
  const school = typeof sp.school === "string" && BIG_TEN.some((u) => u.school_id === sp.school) ? sp.school : undefined;
  const games = await listGames({ sport, school, days: 7 }).catch(() => [] as SportsGame[]);
  const qs = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ sport, school, ...o }).filter(([, v]) => v) as [string, string][]);
    return `/sports${p.size ? `?${p}` : ""}`;
  };
  const groups: [string, SportsGame[]][] = [
    ["Live now", games.filter((g) => g.state === "in")],
    ["Upcoming", games.filter((g) => g.state === "pre").sort((a, b) => a.starts_at.localeCompare(b.starts_at))],
    ["Final", games.filter((g) => g.state === "post").sort((a, b) => b.starts_at.localeCompare(a.starts_at))],
  ];

  return (
    <>
      <nav className="flex flex-wrap gap-1.5 text-sm">
        <Link href={qs({ sport: undefined })} className={`rounded-lg px-3 py-1.5 font-medium ${!sport ? "bg-accent text-accent-ink" : "bg-panel text-muted hover:text-ink"}`}>
          All sports
        </Link>
        {(Object.keys(SPORTS) as SportKey[]).map((k) => (
          <Link key={k} href={qs({ sport: k })} className={`rounded-lg px-3 py-1.5 font-medium ${sport === k ? "bg-accent text-accent-ink" : "bg-panel text-muted hover:text-ink"}`}>
            {SPORTS[k].label}
          </Link>
        ))}
      </nav>
      <nav className="no-scrollbar flex gap-1.5 overflow-x-auto text-xs">
        <Link href={qs({ school: undefined })} className={`shrink-0 rounded-md border px-2 py-1 ${!school ? "border-accent text-accent" : "border-line text-muted"}`}>
          All Big Ten
        </Link>
        {BIG_TEN.map((u) => (
          <Link key={u.school_id} href={qs({ school: u.school_id })} className={`shrink-0 rounded-md border px-2 py-1 ${school === u.school_id ? "border-accent text-accent" : "border-line text-muted"}`}>
            {u.short_name}
          </Link>
        ))}
      </nav>

      {games.length === 0 && (
        <p className="rounded-2xl border border-line bg-panel p-8 text-center text-muted">
          No games in this window yet. The schedule syncs from ESPN every hour.
        </p>
      )}
      {groups.map(([title, list]) =>
        list.length ? (
          <section key={title}>
            <h2 className="mb-2 flex items-center gap-2 font-semibold">
              {title === "Live now" && <i className="inline-block h-2 w-2 animate-pulse rounded-full bg-no" />}
              {title} <span className="text-sm font-normal text-muted">{list.length}</span>
            </h2>
            <ul className="grid gap-3 md:grid-cols-2">
              {list.map((g) => (
                <GameCard key={g.event_id} g={g} />
              ))}
            </ul>
          </section>
        ) : null,
      )}
      <p className="text-xs text-muted">Scores via ESPN&apos;s public scoreboard (unofficial). Synced to Databricks as bronze.sports_games_raw.</p>
    </>
  );
}

function GameCard({ g }: { g: SportsGame }) {
  const live = g.state === "in";
  const row = (name: string, score: number | null, won: boolean) => (
    <div className="flex items-center justify-between">
      <span className={won ? "font-bold" : ""}>{name}</span>
      <b className="tabular text-xl">{g.state === "pre" ? "" : (score ?? 0)}</b>
    </div>
  );
  return (
    <li id={g.event_id} className={`rounded-2xl border bg-panel p-4 ${live ? "border-no/40" : "border-line"}`}>
      <div className="flex items-center justify-between text-xs text-muted">
        <span className="font-semibold uppercase">{SPORTS[g.sport]?.label ?? g.sport}</span>
        <span className={live ? "font-semibold text-no" : ""}>
          {g.state === "pre"
            ? new Date(g.starts_at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }) + " CT"
            : g.detail}
        </span>
      </div>
      <div className="mt-2 space-y-1">
        {row(g.away_name, g.away_score, g.winner_side === "away")}
        {row(`${g.home_name}`, g.home_score, g.winner_side === "home")}
      </div>
      {g.markets.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {g.markets.map((m) => (
            <Link
              key={m.market_id}
              href={`/markets/${m.market_id}`}
              className={`rounded-md px-2 py-1 text-xs font-semibold ${m.status === "live" ? "bg-accent-soft text-accent" : "bg-panel-2 text-muted"}`}
            >
              {KIND_LABEL[m.market_kind] ?? m.market_kind}
              {m.status !== "live" && ` · ${m.status}`}
            </Link>
          ))}
        </div>
      ) : (
        g.state === "pre" && <p className="mt-3 text-xs text-muted">Markets open 4 days before the game.</p>
      )}
    </li>
  );
}
