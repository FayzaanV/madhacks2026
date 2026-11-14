import Link from "next/link";
import { Suspense } from "react";
import { Avatar } from "@/components/avatar";
import { Clout } from "@/components/clout";
import { UNIVERSITIES } from "@/core/universities";
import { querySql } from "@/server/warehouse";

type Row = {
  user_id: string;
  handle: string;
  school_id: string | null;
  clout: number;
  brier: number | null;
  n_trades: number;
  rank: number;
  rank_from_bottom: number;
};
type School = {
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

const SCOPES = [
  { key: "league", label: "University league" },
  { key: "school", label: "By university" },
  { key: "overall", label: "All students" },
  { key: "major", label: "Major" },
  { key: "club", label: "Club" },
  { key: "course", label: "Course" },
] as const;

const schoolMeta = new Map(UNIVERSITIES.map((u) => [u.school_id, u]));
const schoolName = (id: string | null) => (id ? (schoolMeta.get(id)?.short_name ?? id.replace(/^edu-/, "")) : "");

export default function LeaderboardPage({ searchParams }: PageProps<"/leaderboard">) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-bold">Leaderboards</h1>
        <p className="text-muted">
          Every university gets its own board, and anyone can view any school. Ranked by Clout (100 + realized profit).
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
  const scope = SCOPES.some((s) => s.key === sp.scope) ? (sp.scope as string) : "league";

  const league = await querySql<School>(
    `SELECT school_id, name, short_name, color, forecasters, avg_clout, avg_brier, top_clout, rank
     FROM {catalog}.gold.school_rankings ORDER BY rank`,
  ).catch(() => [] as School[]);

  const tabs = (
    <nav className="flex flex-wrap gap-1.5 text-sm">
      {SCOPES.map((s) => (
        <Link
          key={s.key}
          href={`/leaderboard?scope=${s.key}`}
          className={`rounded-lg px-3 py-1.5 font-medium ${s.key === scope ? "bg-accent text-accent-ink" : "bg-panel text-muted hover:text-ink"}`}
        >
          {s.label}
        </Link>
      ))}
    </nav>
  );

  if (scope === "league") return <>{tabs}<League rows={league} /></>;

  const values =
    scope === "overall"
      ? [{ scope_value: "all" }]
      : scope === "school"
        ? league.map((s) => ({ scope_value: s.school_id }))
        : await querySql<{ scope_value: string }>(
            "SELECT DISTINCT scope_value FROM {catalog}.gold.leaderboard WHERE scope = :scope ORDER BY scope_value",
            { scope },
          );
  const value =
    typeof sp.value === "string" && values.some((v) => v.scope_value === sp.value) ? sp.value : (values[0]?.scope_value ?? "all");
  const sql = (order: string, limit: number) =>
    `SELECT user_id, handle, school_id, clout, brier, n_trades, rank, rank_from_bottom FROM {catalog}.gold.leaderboard
     WHERE scope = :scope AND scope_value = :value ORDER BY ${order} LIMIT ${limit}`;
  const [top, shame] = await Promise.all([
    querySql<Row>(sql("rank", 25), { scope, value }),
    querySql<Row>(sql("rank_from_bottom", 10), { scope, value }),
  ]);
  const title = scope === "school" ? (schoolMeta.get(value)?.name ?? schoolName(value)) : scope === "overall" ? "All students, every university" : value;

  return (
    <>
      {tabs}
      {scope !== "overall" && (
        <nav className="no-scrollbar flex gap-1.5 overflow-x-auto text-xs">
          {values.map((v) => (
            <Link
              key={v.scope_value}
              href={`/leaderboard?scope=${scope}&value=${encodeURIComponent(v.scope_value)}`}
              className={`shrink-0 rounded-md border px-2 py-1 ${v.scope_value === value ? "border-accent text-accent" : "border-line text-muted"}`}
            >
              {scope === "school" ? schoolName(v.scope_value) : v.scope_value}
            </Link>
          ))}
        </nav>
      )}
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <Table title={title} rows={top} rankKey="rank" podium showSchool={scope !== "school"} />
        <Table title="Hall of Shame" rows={shame} rankKey="rank_from_bottom" shame showSchool={scope !== "school"} />
      </div>
      <p className="text-xs text-muted">Computed by the Lakeflow pipeline into the_curve.gold.leaderboard and gold.school_rankings.</p>
    </>
  );
}

const MEDAL = ["#f5c542", "#c9ced6", "#d08a4a"];

function SchoolBadge({ id }: { id: string | null }) {
  if (!id) return null;
  const meta = schoolMeta.get(id);
  return (
    <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ background: meta?.color ?? "var(--accent)" }}>
      {schoolName(id)}
    </span>
  );
}

function League({ rows }: { rows: School[] }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-panel">
      <h2 className="px-4 py-3 font-semibold">University league</h2>
      <table className="w-full text-sm">
        <thead className="bg-panel-2 text-left text-xs text-muted">
          <tr>
            <th className="w-12 px-4 py-2">#</th>
            <th>University</th>
            <th className="text-right">Forecasters</th>
            <th className="text-right">Avg Clout</th>
            <th className="hidden text-right sm:table-cell">Top Clout</th>
            <th className="px-4 text-right">Avg Brier</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {rows.map((s) => (
            <tr key={s.school_id} className="border-t border-line hover:bg-panel-2">
              <td className="px-4 py-2.5 text-muted">{s.rank}</td>
              <td>
                <Link href={`/leaderboard?scope=school&value=${encodeURIComponent(s.school_id)}`} className="flex items-center gap-2 font-medium hover:text-accent">
                  <i className="inline-block h-3 w-3 rounded-sm" style={{ background: s.color ?? "var(--accent)" }} />
                  {s.name ?? schoolName(s.school_id)}
                </Link>
              </td>
              <td className="text-right">{s.forecasters.toLocaleString()}</td>
              <td className="text-right font-semibold">{s.avg_clout.toFixed(1)}</td>
              <td className="hidden text-right sm:table-cell">{s.top_clout.toFixed(1)}</td>
              <td className="px-4 text-right text-muted">{s.avg_brier == null ? "–" : s.avg_brier.toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="p-6 text-center text-muted">No forecasters yet.</p>}
    </section>
  );
}

function Table({
  title,
  rows,
  rankKey,
  shame,
  podium,
  showSchool,
}: {
  title: string;
  rows: Row[];
  rankKey: "rank" | "rank_from_bottom";
  shame?: boolean;
  podium?: boolean;
  showSchool?: boolean;
}) {
  return (
    <section className={`overflow-hidden rounded-2xl border bg-panel ${shame ? "border-no/40" : "border-line"}`}>
      <h2 className={`px-4 py-3 font-semibold ${shame ? "text-no" : ""}`}>{title}</h2>
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
                  <Link href={`/u/${r.user_id}`} className="inline-flex items-center gap-2 font-medium hover:text-accent">
                    {/* Leaderboard rows come from gold, which has no avatar data; initials avatar only. */}
                    <Avatar userId={r.user_id} handle={r.handle} size={24} />
                    @{r.handle}
                  </Link>
                  {showSchool && <SchoolBadge id={r.school_id} />}
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
