import Link from "next/link";
import { Suspense } from "react";
import { Clout } from "@/components/clout";
import { MarketCard } from "@/components/market-card";
import { PriceChart } from "@/components/price-chart";
import { CourseIcon, fmtClout } from "@/components/ui";
import { listMarkets, priceHistory, type Market } from "@/server/markets";
import { querySql } from "@/server/warehouse";

type Gap = { market_id: string; question: string; course: string; gap: number; crowd_price: number; smart_price: number; outcome_label: string };
type Leader = { user_id: string; handle: string; clout: number; rank: number };
type SchoolRank = { school_id: string; short_name: string | null; color: string | null; avg_clout: number; rank: number };

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
  if (!cat) return true;
  if (cat === "mispriced") return (gapOf.get(m.market_id) ?? 0) >= 0.1;
  if (cat === "closing") return Date.parse(m.closes_at) - Date.now() < 10 * 864e5;
  if (cat === "campus") return m.course === "campus";
  return m.course.toLowerCase().startsWith(cat.toLowerCase()) || m.course.toLowerCase().includes(`${cat.toLowerCase()} `);
}

async function Board({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const cat = typeof sp.cat === "string" ? sp.cat : "";
  const q = typeof sp.q === "string" ? sp.q : "";
  const [markets, gaps, leaders, schools] = await Promise.all([
    listMarkets("live"),
    querySql<Gap>(
      "SELECT market_id, question, course, gap, crowd_price, smart_price, outcome_label FROM {catalog}.gold.market_mispricing WHERE status = 'live' ORDER BY gap DESC",
    ).catch(() => [] as Gap[]),
    querySql<Leader>(
      "SELECT user_id, handle, clout, rank FROM {catalog}.gold.leaderboard WHERE scope = 'overall' ORDER BY rank LIMIT 5",
    ).catch(() => [] as Leader[]),
    querySql<SchoolRank>(
      "SELECT school_id, short_name, color, avg_clout, rank FROM {catalog}.gold.school_rankings ORDER BY rank LIMIT 5",
    ).catch(() => [] as SchoolRank[]),
  ]);
  const gapOf = new Map(gaps.map((g) => [g.market_id, g.gap]));
  const shown = markets.filter((m) => matches(m, cat, q, gapOf));
  const featured = !cat && !q ? (markets.find((m) => m.market_id === gaps[0]?.market_id) ?? markets[0]) : null;

  return (
    <div className="space-y-8">
      {featured && (
        <section className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <Featured m={featured} gap={gaps[0]} />
          <aside className="space-y-4">
            <SideList title="Smart Money alerts" href="/?cat=mispriced">
              {gaps.slice(0, 4).map((g, i) => (
                <li key={g.market_id}>
                  <Link href={`/markets/${g.market_id}`} className="flex items-start gap-3 py-1.5 hover:opacity-80">
                    <span className="tabular w-4 pt-0.5 text-xs text-muted">{i + 1}</span>
                    <span className="line-clamp-2 flex-1 text-sm">{g.question}</span>
                    <span className="tabular shrink-0 text-right text-xs">
                      <b className="block text-sm">
                        {g.outcome_label} {Math.round(g.crowd_price * 100)}%
                      </b>
                      <span className="text-smart">smart {Math.round(g.smart_price * 100)}%</span>
                    </span>
                  </Link>
                </li>
              ))}
            </SideList>
            <SideList title="University league" href="/leaderboard?scope=league">
              {schools.map((sc) => (
                <li key={sc.school_id}>
                  <Link href={`/leaderboard?scope=school&value=${encodeURIComponent(sc.school_id)}`} className="flex items-center gap-3 py-1.5 text-sm hover:opacity-80">
                    <span className="tabular w-4 text-xs text-muted">{sc.rank}</span>
                    <i className="inline-block h-3 w-3 rounded-sm" style={{ background: sc.color ?? "var(--accent)" }} />
                    <span className="flex-1 truncate">{sc.short_name ?? sc.school_id}</span>
                    <span className="tabular text-xs text-muted">avg {sc.avg_clout.toFixed(1)}</span>
                  </Link>
                </li>
              ))}
            </SideList>
            <SideList title="Top forecasters" href="/leaderboard?scope=overall">
              {leaders.map((l) => (
                <li key={l.user_id}>
                  <Link href={`/u/${l.user_id}`} className="flex items-center gap-3 py-1.5 text-sm hover:opacity-80">
                    <span className="tabular w-4 text-xs text-muted">{l.rank}</span>
                    <span className="flex-1 truncate">@{l.handle}</span>
                    <Clout value={l.clout} className="text-sm" />
                  </Link>
                </li>
              ))}
            </SideList>
          </aside>
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

function SideList({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <Link href={href} className="mb-1 flex items-center gap-1 font-semibold hover:text-accent">
        {title} <span aria-hidden>›</span>
      </Link>
      <ol>{children}</ol>
    </div>
  );
}

async function Featured({ m, gap }: { m: Market; gap?: Gap }) {
  const history = (await priceHistory(m.market_id).catch(() => [])).filter((h) => h.outcome_index === 0);
  return (
    <article className="rounded-2xl border border-line bg-panel p-5">
      <div className="flex items-center gap-3">
        <CourseIcon course={m.course} size={48} />
        <Link href={`/markets/${m.market_id}`} className="text-2xl font-bold leading-tight hover:underline">
          {m.question}
        </Link>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-[220px_1fr]">
        <div className="space-y-3">
          {m.outcomes.map((o) => (
            <Link key={o.outcome_index} href={`/markets/${m.market_id}?pick=${o.outcome_index}`} className="flex items-center justify-between rounded-lg px-1 py-1 hover:bg-panel-2">
              <span>{o.label}</span>
              <span className="tabular text-2xl font-bold">{Math.round(o.price * 100)}%</span>
            </Link>
          ))}
          {gap && gap.market_id === m.market_id && (
            <p className="rounded-lg bg-accent-soft p-3 text-sm">
              <b className="text-smart">Smart Money says {Math.round(gap.smart_price * 100)}%</b> on {gap.outcome_label}. The crowd says{" "}
              {Math.round(gap.crowd_price * 100)}%.
            </p>
          )}
        </div>
        <div>
          <PriceChart points={history.map((p) => ({ t: Date.parse(p.created_at), crowd: p.crowd_price, smart: p.smart_price }))} />
          <div className="mt-1 flex gap-4 text-xs text-muted">
            <span className="flex items-center gap-1"><i className="inline-block h-0.5 w-4 bg-accent" /> Crowd ({m.outcomes[0]?.label})</span>
            <span className="flex items-center gap-1"><i className="inline-block h-0.5 w-4 border-t-2 border-dashed border-smart" /> Smart Money</span>
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted">
        <span className="tabular">{fmtClout(m.volume)} Clout vol.</span>·<span>{m.n_trades.toLocaleString()} trades</span>·
        <span>closes {new Date(m.closes_at).toLocaleDateString()}</span>
        <Link href={`/markets/${m.market_id}`} className="ml-auto rounded-lg bg-accent px-3 py-1.5 font-semibold text-accent-ink">
          Trade
        </Link>
      </div>
    </article>
  );
}
