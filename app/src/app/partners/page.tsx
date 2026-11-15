import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PartnerKeys } from "@/components/partner-keys";
import { isAdmin } from "@/server/markets";
import { q } from "@/server/ledger";
import { canSeePartners, listPartners, unionScorecard } from "@/server/union";
import { currentUser } from "@/server/user";

export default function PartnersPage() {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <Partners />
    </Suspense>
  );
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

async function Partners() {
  const u = await currentUser();
  if (!u) redirect("/login");
  if (!canSeePartners(u))
    return <p className="rounded-2xl border border-line bg-panel p-6 text-sm text-muted">The partner dashboard is for Union staff and Yomi admins.</p>;
  const [{ accuracy, recent }, partners, venues] = await Promise.all([
    unionScorecard(),
    listPartners(),
    q<{ venue_id: string; name: string }>("SELECT venue_id, name FROM venues ORDER BY name"),
  ]);
  const all = accuracy.find((a) => a.venue_id === "__all__");
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Partner dashboard</h1>
        <p className="text-sm text-muted">
          For the Wisconsin Union: what students forecast about your venues, how accurate that crowd is, and how to plug in your data.
        </p>
      </header>

      <section className="rounded-2xl border border-line bg-panel p-4">
        <h2 className="font-semibold">Is the crowd better than your history?</h2>
        <p className="text-sm text-muted">
          Brier score (lower is better) of the market price at close vs. how often the same window met the threshold 1–4 weeks earlier.
          From the Databricks gold table <code>union_accuracy</code>.
        </p>
        {accuracy.length ? (
          <>
            {all && all.n_markets > 0 && (
              <p className="mt-3 text-lg">
                Across {all.n_markets} settled markets the crowd scored <b>{all.crowd_brier.toFixed(3)}</b> vs history{" "}
                <b>{all.history_brier.toFixed(3)}</b>:{" "}
                <b className={all.crowd_edge > 0 ? "text-yes" : "text-no"}>{all.crowd_edge > 0 ? "the crowd wins" : "history wins so far"}</b>.
              </p>
            )}
            <table className="tabular mt-3 w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr><th className="py-1 font-medium">Venue</th><th className="text-right font-medium">Markets</th><th className="text-right font-medium">Crowd</th><th className="text-right font-medium">History</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {accuracy.filter((a) => a.venue_id !== "__all__").map((a) => (
                  <tr key={a.venue_id}>
                    <td className="py-1.5">{a.venue}</td>
                    <td className="text-right">{a.n_markets}</td>
                    <td className="text-right">{a.crowd_brier.toFixed(3)}</td>
                    <td className="text-right">{a.history_brier.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p className="mt-3 text-sm text-muted">No settled Union markets yet. The scorecard fills in as markets settle.</p>
        )}
      </section>

      {recent.length > 0 && (
        <section className="rounded-2xl border border-line bg-panel p-4">
          <h2 className="font-semibold">Recent forecasts vs. what happened</h2>
          <ul className="mt-2 divide-y divide-line text-sm">
            {recent.map((r) => (
              <li key={r.market_id} className="flex flex-wrap items-center gap-3 py-2">
                <Link href={`/markets/${r.market_id}`} className="flex-1 hover:text-accent">
                  {r.question}
                  {r.is_simulated && <span className="ml-2 rounded bg-panel-2 px-1 text-[10px] uppercase text-muted">sim</span>}
                </Link>
                <span className="tabular text-xs text-muted">crowd {pct(r.crowd_p)} · history {pct(r.history_p)}</span>
                <span className={`w-10 text-right text-xs font-semibold ${r.yes ? "text-yes" : "text-no"}`}>{r.yes ? "Yes" : "No"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-line bg-panel p-4">
        <h2 className="font-semibold">API keys</h2>
        <p className="mb-3 text-sm text-muted">One key per partner system (point of sale, sensors). Keys can only write the venues they&apos;re issued for.</p>
        <PartnerKeys partners={partners} venues={venues} canManage={isAdmin(u)} />
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-line bg-panel p-4 text-sm">
          <h2 className="font-semibold">Send us your data</h2>
          <p className="mt-1 text-muted">Partner readings settle markets ahead of any other source.</p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-panel-2 p-3 text-xs">{`POST /api/partner/metrics
Authorization: Bearer yomi_pk_...
[{ "venue_id": "strada", "metric": "sales",
   "value": 212, "observed_at": "2026-11-15T19:00:00Z" },
 { "venue_id": "strada", "metric": "wait_min",
   "value": 7.5, "observed_at": "2026-11-15T19:00:00Z" }]`}</pre>
          <p className="mt-2 text-xs text-muted">Metrics: people, occupancy_pct, wait_min, line_len, sales (cumulative today). Up to 1000 readings per call; repeats are ignored.</p>
        </div>
        <div className="rounded-2xl border border-line bg-panel p-4 text-sm">
          <h2 className="font-semibold">Get the crowd forecast</h2>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-panel-2 p-3 text-xs">{`GET /api/partner/forecasts
Authorization: Bearer yomi_pk_...`}</pre>
          <p className="mt-2 text-muted">
            On Databricks, share the gold tables directly with Delta Sharing instead (if your workspace has it enabled):
          </p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-panel-2 p-3 text-xs">{`CREATE SHARE union_forecasts;
ALTER SHARE union_forecasts ADD TABLE the_curve.gold.union_forecasts;
ALTER SHARE union_forecasts ADD TABLE the_curve.gold.union_accuracy;`}</pre>
          <p className="mt-2 text-xs text-muted">Occuspace sensors connect on the Databricks side: add the token as secret the-curve/occuspace_token.</p>
        </div>
      </section>
    </div>
  );
}
