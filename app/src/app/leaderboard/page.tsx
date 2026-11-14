import Link from "next/link";
import { Suspense } from "react";
import { Clout } from "@/components/clout";
import { querySql } from "@/server/warehouse";

type Row = { user_id: string; handle: string; clout: number; brier: number | null; n_trades: number; rank: number; rank_from_bottom: number };
const SCOPES = ["overall", "major", "dorm", "club", "course"] as const;

export default function LeaderboardPage({ searchParams }: PageProps<"/leaderboard">) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-bold">Leaderboard</h1>
        <p className="text-muted">Ranked by true Clout. Brier score: lower is better.</p>
      </div>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl border border-line bg-panel" />}>
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
  const value =
    typeof sp.value === "string" && values.some((v) => v.scope_value === sp.value) ? sp.value : (values[0]?.scope_value ?? "all");
  const sql = (order: string) =>
    `SELECT user_id, handle, clout, brier, n_trades, rank, rank_from_bottom FROM {catalog}.gold.leaderboard
     WHERE scope = :scope AND scope_value = :value ORDER BY ${order} LIMIT 25`;
  const [top, shame] = await Promise.all([
    querySql<Row>(sql("rank"), { scope, value }),
    querySql<Row>(sql("rank_from_bottom").replace("LIMIT 25", "LIMIT 10"), { scope, value }),
  ]);

  return (
    <>
      <nav className="flex flex-wrap gap-1.5 text-sm">
        {SCOPES.map((s) => (
          <Link
            key={s}
            href={`/leaderboard?scope=${s}`}
            className={`rounded-lg px-3 py-1.5 font-medium capitalize ${s === scope ? "bg-accent text-accent-ink" : "bg-panel text-muted hover:text-ink"}`}
          >
            {s}
          </Link>
        ))}
      </nav>
      {scope !== "overall" && (
        <nav className="no-scrollbar flex gap-1.5 overflow-x-auto text-xs">
          {values.map((v) => (
            <Link
              key={v.scope_value}
              href={`/leaderboard?scope=${scope}&value=${encodeURIComponent(v.scope_value)}`}
              className={`shrink-0 rounded-md border px-2 py-1 ${v.scope_value === value ? "border-accent text-accent" : "border-line text-muted"}`}
            >
              {v.scope_value}
            </Link>
          ))}
        </nav>
      )}
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <Table title={scope === "overall" ? "Top forecasters" : `Top forecasters · ${value}`} rows={top} rankKey="rank" podium />
        <Table title="Hall of Shame" rows={shame} rankKey="rank_from_bottom" shame />
      </div>
      <p className="text-xs text-muted">Computed by the Lakeflow pipeline into the_curve.gold.leaderboard.</p>
    </>
  );
}

const MEDAL = ["#f5c542", "#c9ced6", "#d08a4a"];

function Table({ title, rows, rankKey, shame, podium }: { title: string; rows: Row[]; rankKey: "rank" | "rank_from_bottom"; shame?: boolean; podium?: boolean }) {
  return (
    <section className={`overflow-hidden rounded-2xl border bg-panel ${shame ? "border-no/40" : "border-line"}`}>
      <h2 className={`px-4 py-3 font-semibold ${shame ? "text-no" : ""}`}>{shame ? "🫠 " : ""}{title}</h2>
      <table className="w-full text-sm">
        <thead className="bg-panel-2 text-left text-xs text-muted">
          <tr>
            <th className="w-12 px-4 py-2">#</th>
            <th>Forecaster</th>
            <th className="text-right">Clout</th>
            <th className="px-4 text-right">Brier</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {rows.map((r) => {
            const rank = r[rankKey];
            return (
              <tr key={r.user_id} className="border-t border-line hover:bg-panel-2">
                <td className="px-4 py-2.5">
                  {podium && rank <= 3 ? (
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-black" style={{ background: MEDAL[rank - 1] }}>
                      {rank}
                    </span>
                  ) : (
                    <span className="text-muted">{rank}</span>
                  )}
                </td>
                <td>
                  <Link href={`/u/${r.user_id}`} className="font-medium hover:text-accent">
                    @{r.handle}
                  </Link>
                </td>
                <td className="text-right"><Clout value={r.clout} /></td>
                <td className="px-4 text-right text-muted">{r.brier == null ? "–" : r.brier.toFixed(3)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
