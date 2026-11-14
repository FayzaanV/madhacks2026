import Link from "next/link";
import { Suspense } from "react";
import { Clout } from "@/components/clout";
import { querySql } from "@/server/warehouse";

type Row = { user_id: string; handle: string; clout: number; brier: number | null; n_trades: number; rank: number; rank_from_bottom: number };
const SCOPES = ["overall", "major", "dorm", "club", "course"] as const;

export default function LeaderboardPage({ searchParams }: PageProps<"/leaderboard">) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Leaderboard</h1>
      <Suspense fallback={<p className="text-muted">Loading leaderboard…</p>}>
        <Board searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Board({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const scope = SCOPES.includes(sp.scope as (typeof SCOPES)[number]) ? (sp.scope as string) : "overall";
  const values =
    scope === "overall"
      ? [{ scope_value: "all" }]
      : await querySql<{ scope_value: string }>(
          "SELECT DISTINCT scope_value FROM {catalog}.gold.leaderboard WHERE scope = :scope ORDER BY scope_value",
          { scope },
        );
  const value = typeof sp.value === "string" && values.some((v) => v.scope_value === sp.value) ? sp.value : values[0]?.scope_value ?? "all";
  const [top, shame] = await Promise.all([
    querySql<Row>(
      `SELECT user_id, handle, clout, brier, n_trades, rank, rank_from_bottom FROM {catalog}.gold.leaderboard
       WHERE scope = :scope AND scope_value = :value ORDER BY rank LIMIT 25`,
      { scope, value },
    ),
    querySql<Row>(
      `SELECT user_id, handle, clout, brier, n_trades, rank, rank_from_bottom FROM {catalog}.gold.leaderboard
       WHERE scope = :scope AND scope_value = :value ORDER BY rank_from_bottom LIMIT 10`,
      { scope, value },
    ),
  ]);

  return (
    <>
      <nav className="flex flex-wrap gap-2 text-sm">
        {SCOPES.map((s) => (
          <Link key={s} href={`/leaderboard?scope=${s}`} className={`rounded-full border px-3 py-1 ${s === scope ? "border-accent text-accent" : "border-line text-muted"}`}>
            {s}
          </Link>
        ))}
      </nav>
      {scope !== "overall" && (
        <nav className="flex flex-wrap gap-1.5 text-xs">
          {values.map((v) => (
            <Link key={v.scope_value} href={`/leaderboard?scope=${scope}&value=${encodeURIComponent(v.scope_value)}`}
              className={`rounded border px-2 py-0.5 ${v.scope_value === value ? "border-ink" : "border-line text-muted"}`}>
              {v.scope_value}
            </Link>
          ))}
        </nav>
      )}
      <div className="grid gap-6 md:grid-cols-[1fr_320px]">
        <Table title={`Top forecasters · ${value}`} rows={top} rankKey="rank" />
        <Table title="Hall of Shame" rows={shame} rankKey="rank_from_bottom" shame />
      </div>
      <p className="text-xs text-muted">Computed by the Lakeflow pipeline into the_curve.gold.leaderboard. Brier: lower is better.</p>
    </>
  );
}

function Table({ title, rows, rankKey, shame }: { title: string; rows: Row[]; rankKey: "rank" | "rank_from_bottom"; shame?: boolean }) {
  return (
    <section className={`rounded-xl border bg-panel p-4 ${shame ? "border-no/40" : "border-line"}`}>
      <h2 className="mb-2 font-semibold">{title}</h2>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted">
          <tr><th className="w-8">#</th><th>Forecaster</th><th className="text-right">Clout</th><th className="text-right">Brier</th></tr>
        </thead>
        <tbody className="tabular">
          {rows.map((r) => (
            <tr key={r.user_id} className="border-t border-line">
              <td className="py-1.5 text-muted">{r[rankKey]}</td>
              <td><Link href={`/u/${r.user_id}`} className="hover:underline">@{r.handle}</Link></td>
              <td className="text-right"><Clout value={r.clout} /></td>
              <td className="text-right text-muted">{r.brier == null ? "–" : r.brier.toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
