import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Avatar } from "@/components/avatar";
import { Clout } from "@/components/clout";
import { nameClass } from "@/components/cosmetics";
import { SchoolFilter } from "@/components/school-filter";
import type { Look } from "@/core/cosmetics";
import { UNIVERSITIES } from "@/core/universities";
import { leaderboard, scopeValues } from "@/server/leaderboard";
import { currentUser } from "@/server/user";
import { looksFor } from "@/server/cosmetics";

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

const SCOPES = [
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

  // Old links to the removed "University league" / "By university" tabs land on All students.
  if (sp.scope === "league" || sp.scope === "school") {
    const p = new URLSearchParams({ scope: "overall" });
    if (sp.scope === "school" && typeof sp.value === "string") p.set("school", sp.value);
    redirect(`/leaderboard?${p}`);
  }

  const scope = SCOPES.find((s) => s.key === sp.scope)?.key ?? "overall";

  // University filter: defaults to the signed-in user's school, or all schools when signed out.
  // ?school=all is an explicit "all schools" (so a signed-in user can still pick it).
  const me = await currentUser();
  const options = UNIVERSITIES.map((u) => ({ id: u.school_id, label: u.name ?? schoolName(u.school_id) })).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
  if (me && !options.some((o) => o.id === me.school_id)) options.push({ id: me.school_id, label: schoolName(me.school_id) });
  const schoolParam = typeof sp.school === "string" ? sp.school : undefined;
  const school: string | null =
    schoolParam === "all" ? null : schoolParam && options.some((o) => o.id === schoolParam) ? schoolParam : (me?.school_id ?? null);
  const schoolQs = `school=${encodeURIComponent(school ?? "all")}`;

  // Live from the Lakebase ledger (plain SQL sort, no warehouse): see server/leaderboard.ts.
  const values = (await scopeValues(scope, school)).map((v) => ({ scope_value: v }));
  const value =
    typeof sp.value === "string" && values.some((v) => v.scope_value === sp.value) ? sp.value : (values[0]?.scope_value ?? "all");
  const { top, shame }: { top: Row[]; shame: Row[] } = await leaderboard(scope, value, 25, 10, school);
  // Equipped shop items live in Lakebase and depend on live Clout.
  const looks = await looksFor([...top, ...shame].map((r) => r.user_id));
  const at = school ? ` · ${schoolName(school)}` : "";
  const title =
    scope === "overall"
      ? school
        ? (schoolMeta.get(school)?.name ?? schoolName(school))
        : "All students, every university"
      : `${value}${at}`;

  return (
    <>
      <SchoolFilter options={options} current={school ?? "all"} scope={scope} value={scope === "overall" ? undefined : value} />
      <nav className="flex flex-wrap gap-1.5 text-sm">
        {SCOPES.map((s) => (
          <Link
            key={s.key}
            href={`/leaderboard?scope=${s.key}&${schoolQs}`}
            className={`rounded-lg px-3 py-1.5 font-medium ${s.key === scope ? "bg-accent text-accent-ink" : "bg-panel text-muted hover:text-ink"}`}
          >
            {s.label}
          </Link>
        ))}
      </nav>
      {scope !== "overall" && (
        <nav className="no-scrollbar flex gap-1.5 overflow-x-auto text-xs">
          {values.map((v) => (
            <Link
              key={v.scope_value}
              href={`/leaderboard?scope=${scope}&${schoolQs}&value=${encodeURIComponent(v.scope_value)}`}
              className={`shrink-0 rounded-md border px-2 py-1 ${v.scope_value === value ? "border-accent text-accent" : "border-line text-muted"}`}
            >
              {v.scope_value}
            </Link>
          ))}
        </nav>
      )}
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <Table title={title} rows={top} rankKey="rank" podium showSchool={!school} looks={looks} />
        <Table title="Hall of Shame" rows={shame} rankKey="rank_from_bottom" shame showSchool={!school} looks={looks} />
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

function Table({
  title,
  rows,
  rankKey,
  shame,
  podium,
  showSchool,
  looks,
}: {
  title: string;
  rows: Row[];
  looks: Map<string, Look>;
  rankKey: "rank" | "rank_from_bottom";
  shame?: boolean;
  podium?: boolean;
  showSchool?: boolean;
}) {
  return (
    <section className={`overflow-hidden rounded-2xl border bg-panel ${shame ? "border-down/40" : "border-line"}`}>
      <h2 className={`px-4 py-3 font-semibold ${shame ? "text-down" : ""}`}>{title}</h2>
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
                    {/* Leaderboard rows come from gold, which has no avatar data; initials avatar + shop cosmetics. */}
                    <Avatar userId={r.user_id} handle={r.handle} size={24} look={looks.get(r.user_id)} />
                    <span className={nameClass(looks.get(r.user_id))}>@{r.handle}</span>
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
      {rows.length === 0 && <p className="p-6 text-center text-muted">No forecasters here yet.</p>}
    </section>
  );
}
