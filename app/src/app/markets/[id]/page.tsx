import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AskAnalyst } from "@/components/ask-analyst";
import { BetBox } from "@/components/bet-box";
import { Clout, pct } from "@/components/clout";
import { CommentBox } from "@/components/comment-box";
import { PriceChart } from "@/components/price-chart";
import { OutcomeRows, PickProvider } from "@/components/trade-context";
import { CourseIcon, fmtClout } from "@/components/ui";
import { maxBet } from "@/core/clout";
import { getInsight } from "@/server/analyst";
import { getComments, getMarket, priceHistory, smartMoney, userStake } from "@/server/markets";
import { currentUser } from "@/server/user";

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
  const staked = await userStake(user.user_id, id);
  const limit = maxBet(user.clout);
  const binary = market.market_type === "binary" && market.outcomes.length === 2;
  const pick = Math.min(Math.max(0, Number(sp.pick ?? 0) || 0), market.outcomes.length - 1);
  const outcomes = market.outcomes.map((o) => ({ index: o.outcome_index, label: o.label, price: o.price }));

  return (
    <PickProvider initial={pick}>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-5">
          <header className="flex items-start gap-4">
            <CourseIcon course={market.course} size={64} />
            <div>
              <div className="text-sm text-muted">
                {market.course} · {market.market_type.replace("_", " ")}
                {market.is_simulated && <span className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 text-xs text-accent">simulated</span>}
              </div>
              <h1 className="mt-1 text-2xl font-bold leading-tight md:text-3xl">{market.question}</h1>
            </div>
          </header>

          <Suspense fallback={<div className="h-72 animate-pulse rounded-2xl border border-line bg-panel" />}>
            <Chart id={id} labels={market.outcomes.map((o) => o.label)} />
          </Suspense>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            <span className="tabular">{fmtClout(market.volume)} Clout vol.</span>
            <span>{market.n_trades.toLocaleString()} trades</span>
            <span>Closes {new Date(market.closes_at).toLocaleDateString()}</span>
            {market.resolution_source && <span className="truncate">Resolves from {market.resolution_source}</span>}
          </div>

          <OutcomeRows outcomes={outcomes} binary={binary} />

          <Suspense fallback={<p className="text-sm text-muted">Loading AI analyst…</p>}>
            <Analyst id={id} />
          </Suspense>

          <Suspense fallback={<p className="text-sm text-muted">Loading comments…</p>}>
            <Comments id={id} />
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
            remaining={Math.max(0, limit - staked)}
            limit={limit}
          />
          <div className="rounded-2xl border border-line bg-panel p-4 text-sm">
            <div className="flex justify-between"><span className="text-muted">Your Clout</span><Clout value={user.clout} /></div>
            <div className="mt-1 flex justify-between"><span className="text-muted">Staked here</span><span className="tabular">{staked.toFixed(1)}</span></div>
          </div>
        </aside>
      </div>
    </PickProvider>
  );
}

async function Chart({ id, labels }: { id: string; labels: string[] }) {
  const [history, sm] = await Promise.all([priceHistory(id).catch(() => []), smartMoney(id).catch(() => [])]);
  const series = history.filter((h) => h.outcome_index === 0);
  return (
    <section className="rounded-2xl border border-line bg-panel p-4">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-2 w-2 rounded-full bg-accent" /> Crowd ({labels[0]}) <b className="tabular">{pct(sm[0]?.crowd_price)}</b>
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-2 w-2 rounded-full bg-smart" /> Smart Money <b className="tabular text-smart">{pct(sm[0]?.smart_price)}</b>
        </span>
        <span className="ml-auto text-xs text-muted">from gold tables · refreshes every 15 min</span>
      </div>
      <PriceChart points={series.map((p) => ({ t: Date.parse(p.created_at), crowd: p.crowd_price, smart: p.smart_price }))} height={260} />
    </section>
  );
}

async function Analyst({ id }: { id: string }) {
  const insight = await getInsight(id);
  return <AskAnalyst marketId={id} insight={insight} />;
}

async function Comments({ id }: { id: string }) {
  const comments = await getComments(id);
  return (
    <section className="rounded-2xl border border-line bg-panel p-4">
      <h2 className="font-semibold">Comments <span className="text-sm font-normal text-muted">{comments.length}</span></h2>
      <CommentBox marketId={id} />
      <ul className="mt-3 divide-y divide-line">
        {comments.map((c) => (
          <li key={c.comment_id} className="py-2.5 text-sm">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold">@{c.handle}</span>
              <Clout value={c.clout} className="text-xs" />
              <span className="text-muted">{new Date(c.created_at).toLocaleDateString()}</span>
            </div>
            <p className="mt-0.5">{c.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
