import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AskAnalyst } from "@/components/ask-analyst";
import { BetBox } from "@/components/bet-box";
import { Clout, pct } from "@/components/clout";
import { CommentBox } from "@/components/comment-box";
import { PriceChart } from "@/components/price-chart";
import { maxBet } from "@/core/clout";
import { getInsight } from "@/server/analyst";
import { getComments, getMarket, priceHistory, smartMoney, userStake } from "@/server/markets";
import { currentUser } from "@/server/user";

export default function MarketPage({ params }: PageProps<"/markets/[id]">) {
  return (
    <Suspense fallback={<p className="text-muted">Loading market…</p>}>
      <Market params={params} />
    </Suspense>
  );
}

async function Market({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [market, user] = await Promise.all([getMarket(id), currentUser()]);
  if (!market) notFound();
  const staked = await userStake(user.user_id, id);
  const limit = maxBet(user.clout);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        <section>
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="rounded bg-panel px-1.5 py-0.5 font-medium border border-line">{market.course}</span>
            <span>{market.market_type.replace("_", " ")}</span>
            <span>· closes {new Date(market.closes_at).toLocaleDateString()}</span>
            {market.is_simulated && <span className="text-amber-600">· simulated</span>}
          </div>
          <h1 className="mt-2 text-2xl font-bold leading-tight">{market.question}</h1>
          {market.resolution_source && (
            <p className="mt-1 text-xs text-muted">Resolves from: {market.resolution_source}</p>
          )}
        </section>

        <Suspense fallback={<div className="h-64 rounded-xl border border-line bg-panel" />}>
          <Chart id={id} labels={market.outcomes.map((o) => o.label)} />
        </Suspense>

        <Suspense fallback={<p className="text-sm text-muted">Loading AI analyst…</p>}>
          <Analyst id={id} />
        </Suspense>

        <Suspense fallback={<p className="text-sm text-muted">Loading comments…</p>}>
          <Comments id={id} />
        </Suspense>
      </div>

      <aside className="space-y-4">
        <BetBox
          marketId={id}
          outcomes={market.outcomes.map((o) => ({ index: o.outcome_index, label: o.label, price: o.price }))}
          liquidityB={market.liquidity_b}
          qShares={market.outcomes.map((o) => o.q_shares)}
          remaining={Math.max(0, limit - staked)}
          limit={limit}
          clout={user.clout}
        />
        <div className="rounded-xl border border-line bg-panel p-4 text-sm text-muted">
          You have staked <b className="text-ink">{staked.toFixed(1)}</b> of your{" "}
          <b className="text-ink">{limit.toFixed(1)}</b> max here. Your Clout: <Clout value={user.clout} />
        </div>
      </aside>
    </div>
  );
}

async function Chart({ id, labels }: { id: string; labels: string[] }) {
  const [history, sm] = await Promise.all([priceHistory(id).catch(() => []), smartMoney(id).catch(() => [])]);
  const series = history.filter((h) => h.outcome_index === 0);
  return (
    <section className="rounded-xl border border-line bg-panel p-4">
      <div className="mb-2 flex flex-wrap items-center gap-4 text-sm">
        <span className="font-medium">{labels[0]} price</span>
        <span className="flex items-center gap-1 text-muted">
          <i className="inline-block h-0.5 w-4 bg-ink" /> Crowd
        </span>
        <span className="flex items-center gap-1 text-muted">
          <i className="inline-block h-0.5 w-4 bg-smart" /> Smart Money
        </span>
        {sm[0] && (
          <span className="ml-auto tabular">
            Crowd <b>{pct(sm[0].crowd_price)}</b> · Smart Money <b className="text-smart">{pct(sm[0].smart_price)}</b>
          </span>
        )}
      </div>
      <PriceChart
        points={series.map((p) => ({ t: Date.parse(p.created_at), crowd: p.crowd_price, smart: p.smart_price }))}
      />
      <p className="mt-2 text-xs text-muted">
        History and Smart Money come from the gold tables on Databricks and refresh every 15 minutes. Smart
        Money weights stakes by Clout and only counts users with positive Clout.
      </p>
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
    <section className="rounded-xl border border-line bg-panel p-4">
      <h2 className="font-semibold">Comments</h2>
      <CommentBox marketId={id} />
      <ul className="mt-3 divide-y divide-line">
        {comments.map((c) => (
          <li key={c.comment_id} className="py-2 text-sm">
            <div className="flex gap-2 text-xs text-muted">
              <span>@{c.handle}</span>
              <Clout value={c.clout} className="text-xs" />
            </div>
            <p className="mt-0.5">{c.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
