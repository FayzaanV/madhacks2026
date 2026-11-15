import { fmtDateTime } from "@/core/time";
import Link from "next/link";
import { Suspense } from "react";
import { PersonLine } from "@/components/avatar";
import { Clout } from "@/components/clout";
import { MarketCard } from "@/components/market-card";
import { OddsChart } from "@/components/odds-chart";
import { CourseIcon, fmtClout } from "@/components/ui";
import { listMarkets, type Market } from "@/server/markets";
import { oddsSeries } from "@/server/portfolio";
import { leaderboard } from "@/server/leaderboard";
import { querySql } from "@/server/warehouse";

type Gap = { market_id: string; question: string; course: string; gap: number; crowd_price: number; smart_price: number; outcome_label: string };
type Leader = { user_id: string; handle: string; clout: number; rank: number; is_simulated: boolean };

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<BoardSkeleton />}>
      <Board searchParams={searchParams} />
    </Suspense>
  );
}

function BoardSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 9 }, (_, i) => (
        <div key={i} className="h-40 animate-pulse rounded-2xl border border-line bg-panel" />
      ))}
    </div>
  );
}

function matches(m: Market, cat: string, q: string, gapOf: Map<string, number>) {
  if (q && !`${m.question} ${m.course}`.toLowerCase().includes(q.toLowerCase())) return false;
  // Sports and intramural markets (hundreds, auto-created) live on /sports and /intramurals; search still finds them.
  if (!q && (m.category === "sports" || m.category === "intramural")) return false;
  if (!cat) return true;
  if (cat === "mispriced") return (gapOf.get(m.market_id) ?? 0) >= 0.1;
  if (cat === "closing") return Date.parse(m.closes_at) - Date.now() < 864e5; // open markets closing within 24h
  if (cat === "campus") return m.course === "campus";
  return m.course.toLowerCase().startsWith(cat.toLowerCase()) || m.course.toLowerCase().includes(`${cat.toLowerCase()} `);
}

/** Yes reads green and No reads red on binary markets; other outcomes stay neutral. */
const outcomeTone = (label: string) => (label === "Yes" ? "text-yes" : label === "No" ? "text-down" : "");

async function Board({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const cat = typeof sp.cat === "string" ? sp.cat : "";
  const q = typeof sp.q === "string" ? sp.q : "";
  const [markets, awaiting, gaps, board] = await Promise.all([
    listMarkets("live"),
    listMarkets("awaiting"),
    querySql<Gap>(
      "SELECT market_id, question, course, gap, crowd_price, smart_price, outcome_label FROM {catalog}.gold.market_mispricing WHERE status = 'live' ORDER BY gap DESC",
    ).catch(() => [] as Gap[]),
    // Live from the Lakebase ledger (plain SQL sort, no warehouse): server/leaderboard.ts. Top 5 and bottom 5 in one call.
    leaderboard("overall", "all", 5, 5),
  ]);
  const leaders: Leader[] = board.top;
  // `shame` comes back lowest-first; show the five lowest with the highest of them on top, like the top list.
  const bottom: Leader[] = board.shame;
  const gapOf = new Map(gaps.map((g) => [g.market_id, g.gap]));
  const shown = markets.filter((m) => matches(m, cat, q, gapOf));
  const featured = !cat && !q ? (markets.find((m) => m.market_id === gaps[0]?.market_id) ?? markets[0]) : null;

  return (
    <div className="space-y-8">
      {featured && (
        <section className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <Featured m={featured} gap={gaps[0]} />
          <aside className="flex flex-col gap-4">
            <SideList title="Top 5 forecasters" subtitle="Highest Clout overall" href="/leaderboard?scope=overall">
              <LeaderRows rows={leaders} />
            </SideList>
            <SideList title="Bottom 5 forecasters" subtitle="Lowest Clout overall" href="/leaderboard?scope=overall">
              <LeaderRows rows={bottom} />
            </SideList>
          </aside>
        </section>
      )}

      {awaiting.length > 0 && !q && (
        <section className="rounded-2xl border border-line bg-panel p-4">
          <h2 className="font-semibold">
            Awaiting resolution <span className="text-sm font-normal text-muted">{awaiting.length} closed, not settled yet</span>
          </h2>
          <ul className="mt-2 divide-y divide-line text-sm">
            {awaiting.map((m) => (
              <li key={m.market_id}>
                <Link href={`/markets/${m.market_id}`} className="flex items-center gap-3 py-2 hover:text-accent">
                  <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted">Closed</span>
                  <span className="flex-1">{m.question}</span>
                  <span className="text-xs text-muted">closed {fmtDateTime(m.closes_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-baseline gap-3">
          <h2 className="text-xl font-bold">{q ? `Results for “${q}”` : "All markets"}</h2>
          <span className="text-sm text-muted">{shown.length} live</span>
        </div>
        {shown.length === 0 ? (
          <p className="rounded-2xl border border-line bg-panel p-8 text-center text-muted">No markets match. Try another category.</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((m) => (
              <li key={m.market_id}>
                <MarketCard m={m} smartGap={gapOf.get(m.market_id)} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SideList({ title, subtitle, href, children }: { title: string; subtitle: string; href: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col rounded-2xl border border-line bg-panel p-4">
      <Link href={href} className="flex items-center justify-between font-semibold hover:text-accent">
        {title} <span aria-hidden>›</span>
      </Link>
      <p className="mb-2 text-xs text-muted">{subtitle}</p>
      <ol className="flex flex-1 flex-col justify-evenly">{children}</ol>
    </div>
  );
}

/** Numbered 1–5 in list order, with the handle on the left and Clout on the right. */
function LeaderRows({ rows }: { rows: Leader[] }) {
  return (
    <>
      {rows.map((l, i) => (
        <li key={l.user_id}>
          <Link href={`/u/${l.user_id}`} className="flex items-center gap-3 py-1.5 text-sm hover:opacity-80">
            <span className="tabular w-4 text-xs text-muted">{i + 1}</span>
            <span className="flex-1 truncate">
              <PersonLine handle={l.handle} sim={l.is_simulated} />
            </span>
            <Clout value={l.clout} className="text-sm" />
          </Link>
        </li>
      ))}
    </>
  );
}

async function Featured({ m, gap }: { m: Market; gap?: Gap }) {
  const points = await oddsSeries(m.market_id).catch(() => []);
  return (
    <article className="flex flex-col rounded-2xl border border-line bg-panel p-5">
      <div className="flex items-center gap-3">
        <CourseIcon course={m.course} size={48} />
        <Link href={`/markets/${m.market_id}`} className="text-2xl font-bold leading-tight hover:underline">
          {m.question}
        </Link>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-3">
        {m.outcomes.map((o) => (
          <Link
            key={o.outcome_index}
            href={`/markets/${m.market_id}?pick=${o.outcome_index}`}
            className={`flex items-baseline gap-3 rounded-lg px-1 py-1 hover:bg-panel-2 ${outcomeTone(o.label)}`}
          >
            <span>{o.label}</span>
            <span className="tabular text-2xl font-bold">{Math.round(o.price * 100)}%</span>
          </Link>
        ))}
        {gap && gap.market_id === m.market_id && (
          <p className="max-w-sm rounded-lg bg-accent-soft p-3 text-sm">
            <b className="text-smart">Smart Money says {Math.round(gap.smart_price * 100)}%</b> on {gap.outcome_label}. The crowd says{" "}
            {Math.round(gap.crowd_price * 100)}%.
          </p>
        )}
      </div>
      <div className="mt-4">
        <OddsChart
          labels={m.outcomes.map((o) => o.label)}
          points={points}
          width={900}
          height={230}
          action={
            <Link
              href={`/markets/${m.market_id}`}
              className="block rounded-xl bg-accent px-12 py-[17px] text-2xl font-bold text-accent-ink shadow-card hover:brightness-95"
            >
              Trade
            </Link>
          }
        />
      </div>
      <div className="mt-auto flex items-center gap-2 pt-3 text-xs text-muted">
        <span className="tabular">{fmtClout(m.volume)} Clout vol.</span>·<span>{m.n_trades.toLocaleString()} trades</span>·
        <span>closes {fmtDateTime(m.closes_at)}</span>
      </div>
    </article>
  );
}
