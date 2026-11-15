import { fmtDate, fmtDateTime, fmtTime } from "@/core/time";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AskAnalyst } from "@/components/ask-analyst";
import { Avatar, PersonLine } from "@/components/avatar";
import { BetBox } from "@/components/bet-box";
import { Clout } from "@/components/clout";
import { CommentList } from "@/components/comment-list";
import { MarketTabs, ProfileLink } from "@/components/market-tabs";
import { OddsChart } from "@/components/odds-chart";
import { OutcomeRows, PickProvider } from "@/components/trade-context";
import { LiveScore } from "@/components/live-score";
import { CourseIcon, fmtClout } from "@/components/ui";
import { getInsight } from "@/server/analyst";
import { canResolve, getComments, getMarket } from "@/server/markets";
import { marketActivity, oddsSeries, positions, topHolders, type Position } from "@/server/portfolio";
import { ResolveBox } from "@/components/resolve-box";
import Link from "next/link";
import { currentUser } from "@/server/user";
import { RuleChart } from "@/components/rule-chart";
import { marketRule, METRIC_LABEL } from "@/server/union";

const ago = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return fmtDate(iso);
};

export default function MarketPage({ params, searchParams }: PageProps<"/markets/[id]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl border border-line bg-panel" />}>
      <Market params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Market({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [market, user] = await Promise.all([getMarket(id), currentUser()]);
  if (!market) notFound();
  const mine = user ? await positions(user.user_id, id) : [];
  const binary = market.market_type === "binary" && market.outcomes.length === 2;
  const pick = Math.min(Math.max(0, Number(sp.pick ?? 0) || 0), market.outcomes.length - 1);
  const outcomes = market.outcomes.map((o) => ({ index: o.outcome_index, label: o.label, price: o.price }));
  const holdings = market.outcomes.map((o) => mine.find((p) => p.outcome_index === o.outcome_index)?.shares ?? 0);
  const labels = market.outcomes.map((o) => o.label);

  return (
    // Keyed so "Sell →" links (?side=sell&pick=i) reset the selected outcome and the Buy/Sell toggle.
    <PickProvider key={`${pick}-${sp.side ?? "buy"}`} initial={pick}>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-5">
          <header className="flex items-start gap-4">
            <CourseIcon course={market.course} size={64} />
            <div>
              <div className="text-sm text-muted">
                {market.course} · {market.market_type.replace("_", " ")}
                {market.is_simulated && <span className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 text-xs text-accent">simulated</span>}
                {market.status !== "live" && <span className="ml-2 rounded bg-panel-2 px-1.5 py-0.5 text-xs font-semibold">{market.status}</span>}
              </div>
              <h1 className="mt-1 text-2xl font-bold leading-tight md:text-3xl">{market.question}</h1>
            </div>
          </header>

          {market.game && (
            <LiveScore
              initial={market.game}
              eventId={market.category === "sports" ? market.event_ref : null}
              market={{ kind: market.market_kind, resolved: market.winning_outcome_index != null || market.status === "voided" }}
            />
          )}

          {market.winning_outcome_index != null ? (
            <div className="rounded-2xl border border-yes bg-yes-soft p-4 text-sm">
              <b>Resolved: {labels[market.winning_outcome_index]} won.</b> Each {labels[market.winning_outcome_index]} share paid 1 Clout.
              {market.resolution_note && <p className="mt-1 text-muted">Source: {market.resolution_note}</p>}
            </div>
          ) : market.status === "voided" ? (
            <div className="rounded-2xl border border-line bg-panel-2 p-4 text-sm"><b>Voided.</b> Everyone&apos;s net Clout in this market was returned.</div>
          ) : (
            market.status === "live" &&
            market.past_close && (
              <div className="rounded-2xl border border-line bg-panel-2 p-4 text-sm"><b>Trading closed</b> {fmtDateTime(market.closes_at)}. Awaiting resolution.</div>
            )
          )}

          <Suspense fallback={<div className="h-80 animate-pulse rounded-2xl border border-line bg-panel" />}>
            <Chart id={id} labels={labels} />
          </Suspense>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            <span className="tabular">{fmtClout(market.volume)} Clout vol.</span>
            <span>{market.n_trades.toLocaleString()} trades</span>
            <span>{market.past_close ? "Closed" : "Closes"} {fmtDateTime(market.closes_at)}</span>
            {market.resolution_source && <span className="truncate">Resolves from {market.resolution_source}</span>}
          </div>

          <OutcomeRows outcomes={outcomes} binary={binary} />

          {market.course === "Union" && (
            <Suspense fallback={<div className="h-48 animate-pulse rounded-2xl border border-line bg-panel" />}>
              <HowItSettles id={id} />
            </Suspense>
          )}

          <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl border border-line bg-panel" />}>
            <Bets id={id} labels={labels} />
          </Suspense>

          <Suspense fallback={<p className="text-sm text-muted">Loading AI analyst…</p>}>
            <Analyst id={id} />
          </Suspense>

          <Suspense fallback={<p className="text-sm text-muted">Loading comments…</p>}>
            <Comments id={id} me={user ? { user_id: user.user_id, handle: user.handle, title: user.title, avatar_v: user.avatar_v, clout: user.clout + user.open_stake } : null} />
          </Suspense>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-28 lg:self-start">
          <BetBox
            marketId={id}
            question={market.question}
            binary={binary}
            outcomes={outcomes}
            liquidityB={market.liquidity_b}
            qShares={market.outcomes.map((o) => o.q_shares)}
            available={user ? Math.max(0, user.clout) : null}
            holdings={holdings}
            initialSide={sp.side === "sell" ? "sell" : "buy"}
          />
          {mine.length > 0 && <YourPosition positions={mine} />}
          {user && canResolve(user) && ["live", "closed"].includes(market.status) && (
            <ResolveBox marketId={id} outcomes={outcomes} />
          )}
          {user ? (
            <div className="rounded-2xl border border-line bg-panel p-4 text-sm">
              <div className="flex justify-between"><span className="text-muted">Your Clout</span><Clout value={user.clout + user.open_stake} /></div>
              <div className="mt-1 flex justify-between"><span className="text-muted">Available to bet</span><span className="tabular">{Math.floor(user.clout)}</span></div>
              <Link href="/portfolio" className="mt-2 block text-xs font-semibold text-accent">View portfolio →</Link>
            </div>
          ) : (
            <p className="rounded-2xl border border-line bg-panel p-4 text-sm text-muted">
              <Link href="/login" className="font-semibold text-accent">Sign in</Link> with your university email to bet. You start with 100 Clout.
            </p>
          )}
        </aside>
      </div>
    </PickProvider>
  );
}

/** Your shares per outcome in this market: average price, value now, unrealized P&L, and a sell shortcut. */
function YourPosition({ positions }: { positions: Position[] }) {
  return (
    <section className="rounded-2xl border border-line bg-panel p-4 text-sm">
      <h2 className="font-semibold">Your position</h2>
      <ul className="mt-2 space-y-3">
        {positions.map((p) => (
          <li key={p.outcome_index}>
            <div className="flex items-baseline justify-between">
              <span className="font-semibold">{p.label}</span>
              <span className="tabular">{p.shares.toFixed(1)} shares</span>
            </div>
            <div className="tabular mt-0.5 flex justify-between text-xs text-muted">
              <span>avg {Math.round(p.avg_price * 100)}¢ → now {Math.round(p.price * 100)}¢</span>
              <span>
                value {p.value.toFixed(1)} ·{" "}
                <b className={p.pnl >= 0 ? "text-yes" : "text-no"}>
                  {p.pnl >= 0 ? "+" : ""}
                  {p.pnl.toFixed(1)}
                </b>
              </span>
            </div>
            {p.status === "live" && p.shares > 0 && (
              <Link href={`?side=sell&pick=${p.outcome_index}`} scroll={false} className="mt-1 inline-block text-xs font-semibold text-accent">
                Sell {p.label} →
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

async function Chart({ id, labels }: { id: string; labels: string[] }) {
  const points = await oddsSeries(id);
  return (
    <section className="rounded-2xl border border-line bg-panel p-4">
      <OddsChart labels={labels} points={points} />
      <p className="mt-2 text-xs text-muted">Odds live from the Lakebase ledger · Smart Money (dashed) from gold tables, refreshed every 15 min and after each resolution</p>
    </section>
  );
}

/** Everyone's bets: recent activity and top holders per outcome, with a "Real people only" filter. */
async function Bets({ id, labels }: { id: string; labels: string[] }) {
  const [activity, holders, realActivity, realHolders] = await Promise.all([
    marketActivity(id),
    topHolders(id),
    marketActivity(id, true),
    topHolders(id, true),
  ]);
  return (
    <MarketTabs
      tabs={[
        {
          id: "activity",
          label: "Activity",
          count: activity.length,
          body: <ActivityList rows={activity} empty="No trades yet." />,
          real: <ActivityList rows={realActivity} empty="No real bets yet. Be the first." />,
          realCount: realActivity.length,
        },
        {
          id: "holders",
          label: "Top holders",
          body: <HolderGrid labels={labels} holders={holders} />,
          real: <HolderGrid labels={labels} holders={realHolders} />,
        },
      ]}
    />
  );
}

function ActivityList({ rows, empty }: { rows: Awaited<ReturnType<typeof marketActivity>>; empty: string }) {
  if (!rows.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="max-h-[420px] divide-y divide-line overflow-y-auto pr-1 text-sm">
      {rows.map((a) => (
        <li key={a.trade_id} className="flex items-center gap-3 py-2">
          <ProfileLink userId={a.user_id}>
            <Avatar userId={a.user_id} handle={a.handle} v={a.avatar_v} size={26} />
            <PersonLine handle={a.handle} title={a.title} sim={a.is_simulated} />
          </ProfileLink>
          <span className="ml-auto shrink-0 text-right">
            <span className={a.side === "buy" ? "text-yes" : "text-no"}>{a.side === "buy" ? "Bought" : "Sold"}</span>{" "}
            <span className="tabular">{a.shares.toFixed(1)}</span> <b>{a.label}</b>{" "}
            <span className="tabular text-muted">@ {Math.round(a.price * 100)}¢ · {Math.round(a.clout)} Clout</span>
          </span>
          <span className="w-16 shrink-0 text-right text-xs text-muted">{ago(a.created_at)}</span>
        </li>
      ))}
    </ul>
  );
}

function HolderGrid({ labels, holders }: { labels: string[]; holders: Awaited<ReturnType<typeof topHolders>> }) {
  return (
    <div className={`grid gap-6 ${labels.length > 1 ? "sm:grid-cols-2" : ""}`}>
      {labels.map((label, i) => {
        const hs = holders.filter((h) => h.outcome_index === i);
        return (
          <div key={i}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{label}</h3>
            {hs.length ? (
              <ol className="space-y-1.5 text-sm">
                {hs.map((h) => (
                  <li key={h.user_id} className="flex items-center gap-2">
                    <ProfileLink userId={h.user_id}>
                      <Avatar userId={h.user_id} handle={h.handle} v={h.avatar_v} size={22} />
                      <PersonLine handle={h.handle} title={h.title} sim={h.is_simulated} />
                    </ProfileLink>
                    <span className="tabular ml-auto">{h.shares.toFixed(1)} shares</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted">Nobody yet.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}


/** Union markets settle themselves: show the rule, where the data comes from, and the metric vs the threshold. */
async function HowItSettles({ id }: { id: string }) {
  const r = await marketRule(id);
  if (!r) return null;
  const unit = r.metric === "occupancy_pct" ? "%" : r.metric === "wait_min" ? " min" : "";
  const aggWord = r.agg === "max" ? "peak" : r.agg === "last" ? "reading at the end of" : "average";
  const src = r.sources.includes("partner") ? "the Union point of sale" : r.sources.includes("occuspace") ? "Occuspace sensors" : "the simulated venue feed";
  return (
    <section className="rounded-2xl border border-line bg-panel p-4 text-sm">
      <h2 className="font-semibold">How this settles</h2>
      <p className="mt-1">
        Yes if the <b>{aggWord}</b> {METRIC_LABEL[r.metric]} at <b>{r.venue}</b> between {fmtTime(r.window_start)} and {fmtTime(r.window_end)} is{" "}
        <b>{r.op === ">=" ? "at least" : "below"} {r.threshold}{unit}</b>. Settled automatically by a Databricks job from {src}
        {" "}(partner data first, then sensors; student check-ins if neither covers the window; otherwise voided).
      </p>
      {r.baseline && (
        <p className="mt-1 text-xs text-muted">
          Typical for this weekday and hour (last 28 days, gold): {Math.round(r.baseline.p25)}–{Math.round(r.baseline.p75)}{unit}, median {Math.round(r.baseline.p50)}{unit}.
        </p>
      )}
      <div className="mt-3">
        <RuleChart series={r.series.filter((p) => p.source === (r.sources.includes("partner") ? "partner" : r.sources.includes("occuspace") ? "occuspace" : "sim"))} threshold={r.threshold} unit={unit} />
      </div>
    </section>
  );
}

async function Analyst({ id }: { id: string }) {
  const insight = await getInsight(id);
  return <AskAnalyst marketId={id} insight={insight} />;
}

async function Comments({ id, me }: { id: string; me: React.ComponentProps<typeof CommentList>["me"] }) {
  const initial = await getComments(id);
  return <CommentList marketId={id} initial={initial} me={me} />;
}
