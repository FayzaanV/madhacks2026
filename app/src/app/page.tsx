import Link from "next/link";
import { Suspense } from "react";
import { pct } from "@/components/clout";
import { listMarkets } from "@/server/markets";
import { querySql } from "@/server/warehouse";

export default function Home() {
  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-3xl font-bold tracking-tight">Bet your Clout, not your cash.</h1>
        <p className="mt-1 text-muted">
          Forecast waitlists, midterm averages and Badgers games. Your reputation is the stake.
        </p>
      </section>
      <Suspense fallback={<p className="text-muted">Loading markets…</p>}>
        <Markets />
      </Suspense>
    </div>
  );
}

async function Markets() {
  const [markets, gaps] = await Promise.all([
    listMarkets("live"),
    querySql<{ market_id: string; gap: number }>(
      "SELECT market_id, gap FROM {catalog}.gold.market_mispricing WHERE status = 'live'",
    ).catch(() => []),
  ]);
  const gapOf = new Map(gaps.map((g) => [g.market_id, g.gap]));
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {markets.map((m) => {
        const gap = gapOf.get(m.market_id) ?? 0;
        return (
          <li key={m.market_id}>
            <Link
              href={`/markets/${m.market_id}`}
              className="block h-full rounded-xl border border-line bg-panel p-4 transition hover:border-accent"
            >
              <div className="flex items-center gap-2 text-xs text-muted">
                <span className="rounded bg-bg px-1.5 py-0.5 font-medium">{m.course}</span>
                <span>{m.n_trades.toLocaleString()} trades</span>
                {gap >= 0.15 && (
                  <span className="ml-auto rounded bg-smart/10 px-1.5 py-0.5 font-medium text-smart">
                    Smart Money disagrees
                  </span>
                )}
              </div>
              <p className="mt-2 font-medium leading-snug">{m.question}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {m.outcomes.map((o) => (
                  <span key={o.outcome_index} className="tabular rounded-md border border-line px-2 py-1 text-sm">
                    {o.label} <b>{pct(o.price)}</b>
                  </span>
                ))}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
