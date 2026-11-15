import { fmtDateTime } from "@/core/time";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CloutChart } from "@/components/clout-chart";
import { Clout } from "@/components/clout";
import { cloutHistory, positions, summarize, tradeHistory, type Position } from "@/server/portfolio";
import { currentUser } from "@/server/user";

export default function PortfolioPage({ searchParams }: PageProps<"/portfolio">) {
  return (
    <Suspense fallback={<p className="text-muted">Loading portfolio…</p>}>
      <Portfolio searchParams={searchParams} />
    </Suspense>
  );
}

const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;

async function Portfolio({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const u = await currentUser();
  if (!u) redirect("/login");
  const page = Math.max(0, Number((await searchParams).page ?? 0) || 0);
  const [pos, trades, { points: history, asOf }] = await Promise.all([positions(u.user_id), tradeHistory(u.user_id, page), cloutHistory(u.user_id)]);
  const s = summarize(u.clout, pos);
  const open = pos.filter((p) => ["live", "closed"].includes(p.status));
  const settled = pos.filter((p) => !["live", "closed"].includes(p.status));
  // Gold history (sells + resolutions) plus a starting point and the live value now from the ledger.
  const first = trades.at(-1)?.created_at;
  const points = [
    ...(first && (!history.length || Date.parse(first) < history[0].t) ? [{ t: Date.parse(first), clout: 100 }] : []),
    ...history,
    { t: asOf, clout: s.clout },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Portfolio</h1>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Card label="Clout" value={<Clout value={s.clout} />} hint="available + held at cost" />
        <Card label="Available" value={Math.floor(s.available).toLocaleString()} hint="ready to bet" />
        <Card label="Positions value" value={s.positions_value.toFixed(1)} hint="at current odds" />
        <Card label="Unrealized P&L" value={<Pnl v={s.unrealized} />} hint="if you sold at current odds" />
        <Card label="Realized P&L" value={<Pnl v={s.realized} />} hint="vs your starting 100" />
      </section>

      <section className="rounded-2xl border border-line bg-panel p-4">
        <CloutChart points={points} />
        <p className="mt-2 text-xs text-muted">History from the gold table user_clout_history (refreshed by the Databricks job) · latest point live from the ledger</p>
      </section>

      <PositionsTable title="Open positions" rows={open} empty="No open positions. Find a market and place a bet." live />
      {settled.length > 0 && <PositionsTable title="Settled" rows={settled} empty="" />}

      <section className="rounded-2xl border border-line bg-panel p-4">
        <h2 className="font-semibold">Trade history</h2>
        {trades.length ? (
          <table className="tabular mt-2 w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr><th className="py-1 font-medium">When</th><th className="font-medium">Market</th><th className="font-medium">Trade</th><th className="text-right font-medium">Clout</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {trades.map((t) => (
                <tr key={t.trade_id}>
                  <td className="py-2 pr-3 text-xs text-muted">{fmtDateTime(t.created_at)}</td>
                  <td className="max-w-xs truncate pr-3"><Link href={`/markets/${t.market_id}`} className="hover:text-accent">{t.question}</Link></td>
                  <td className="whitespace-nowrap pr-3">
                    <span className={t.side === "buy" ? "text-yes" : "text-no"}>{t.side === "buy" ? "Bought" : "Sold"}</span> {t.shares.toFixed(1)} {t.label} @ {Math.round(t.price * 100)}¢
                  </td>
                  <td className="text-right">{t.side === "buy" ? "−" : "+"}{t.clout.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-2 text-sm text-muted">No trades yet.</p>
        )}
        <div className="mt-3 flex justify-between text-sm">
          {page > 0 ? <Link href={`?page=${page - 1}`} className="text-accent">← Newer</Link> : <span />}
          {trades.length === 50 && <Link href={`?page=${page + 1}`} className="text-accent">Older →</Link>}
        </div>
      </section>
    </div>
  );
}

function Card({ label, value, hint }: { label: string; value: React.ReactNode; hint: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="tabular mt-0.5 text-lg font-semibold">{value}</div>
      <div className="text-xs text-muted">{hint}</div>
    </div>
  );
}

const Pnl = ({ v }: { v: number }) => <span className={v > 0.05 ? "text-yes" : v < -0.05 ? "text-no" : ""}>{signed(v)}</span>;

function PositionsTable({ title, rows, empty, live }: { title: string; rows: Position[]; empty: string; live?: boolean }) {
  return (
    <section className="rounded-2xl border border-line bg-panel p-4">
      <h2 className="font-semibold">{title} <span className="text-sm font-normal text-muted">{rows.length}</span></h2>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="tabular mt-2 w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-1 font-medium">Market</th>
                <th className="font-medium">Outcome</th>
                <th className="text-right font-medium">Shares</th>
                <th className="text-right font-medium">Avg → now</th>
                <th className="text-right font-medium">{live ? "Value" : "Payout"}</th>
                <th className="text-right font-medium">P&L</th>
                {live && <th />}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((p) => (
                <tr key={`${p.market_id}-${p.outcome_index}`}>
                  <td className="max-w-xs truncate py-2 pr-3"><Link href={`/markets/${p.market_id}`} className="hover:text-accent">{p.question}</Link></td>
                  <td className="pr-3">
                    {p.label}
                    {!live && p.winning_outcome_index != null && (
                      <span className={`ml-1.5 text-xs ${p.winning_outcome_index === p.outcome_index ? "text-yes" : "text-no"}`}>
                        {p.winning_outcome_index === p.outcome_index ? "won" : "lost"}
                      </span>
                    )}
                    {p.status === "voided" && <span className="ml-1.5 text-xs text-muted">voided</span>}
                  </td>
                  <td className="text-right">{p.shares.toFixed(1)}</td>
                  <td className="text-right">{Math.round(p.avg_price * 100)}¢ → {Math.round(p.price * 100)}¢</td>
                  <td className="text-right">{p.value.toFixed(1)}</td>
                  <td className="text-right"><Pnl v={p.pnl} /></td>
                  {live && (
                    <td className="pl-3 text-right">
                      {p.status === "live" && (
                        <Link href={`/markets/${p.market_id}?side=sell&pick=${p.outcome_index}`} className="text-xs font-semibold text-accent">Sell</Link>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted">{empty}</p>
      )}
    </section>
  );
}
