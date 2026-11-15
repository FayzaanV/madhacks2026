import Link from "next/link";
import { Suspense } from "react";
import { VenueReport } from "@/components/venue-report";
import { busyLevel, canSeePartners, listVenues, METRIC_LABEL, type Venue } from "@/server/union";
import { currentUser } from "@/server/user";

export default function UnionPage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl border border-line bg-panel" />}>
      <Union />
    </Suspense>
  );
}

const LEVEL_STYLE: Record<string, string> = {
  "Very busy": "bg-no-soft text-no",
  Busy: "bg-accent-soft text-accent",
  "Not busy": "bg-yes-soft text-yes",
  unknown: "bg-panel-2 text-muted",
};

async function Union() {
  const [venues, user] = await Promise.all([listVenues(), currentUser()]);
  const anySim = venues.some((v) => Object.values(v.latest).some((r) => r.is_simulated));
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-bold">Union</h1>
          <p className="text-sm text-muted">
            Forecast how busy the Wisconsin Union gets. Markets open every morning and settle themselves from live venue data.
          </p>
        </div>
        {user && canSeePartners(user) && (
          <Link href="/partners" className="ml-auto rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-accent">
            Partner dashboard →
          </Link>
        )}
      </header>
      {anySim && (
        <p className="rounded-xl bg-panel-2 px-4 py-2 text-xs text-muted">
          Some venues show <b>simulated</b> data until the Union connects its Occuspace sensors and point-of-sale feed.
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {venues.map((v) => (
          <VenueCard key={v.venue_id} v={v} signedIn={!!user} />
        ))}
      </div>
    </div>
  );
}

function VenueCard({ v, signedIn }: { v: Venue; signedIn: boolean }) {
  const pct = v.latest.occupancy_pct?.value ?? null;
  const head = v.latest[v.headline];
  const level = v.headline === "occupancy_pct" ? busyLevel(pct) : null;
  const src = head?.source;
  return (
    <section className="flex flex-col rounded-2xl border border-line bg-panel p-4">
      <div className="flex items-start gap-2">
        <div>
          <h2 className="font-semibold">{v.name}</h2>
          <p className="text-xs text-muted">{v.building}</p>
        </div>
        {level && <span className={`ml-auto rounded-md px-2 py-0.5 text-xs font-semibold ${LEVEL_STYLE[level]}`}>{level}</span>}
      </div>

      <div className="mt-3 flex items-end gap-4">
        <div className="tabular text-3xl font-bold">
          {head ? Math.round(head.value) : "–"}
          <span className="ml-1 text-sm font-medium text-muted">{METRIC_LABEL[v.headline]}</span>
        </div>
        <div className="tabular text-xs text-muted">
          {v.latest.people && <div>{Math.round(v.latest.people.value)} people now</div>}
          {v.latest.line_len && <div>{Math.round(v.latest.line_len.value)} in line</div>}
          {v.latest.sales && <div>{Math.round(v.latest.sales.value)} sold today</div>}
        </div>
        <Sparkline points={v.today} max={v.headline === "occupancy_pct" ? 100 : undefined} />
      </div>
      <p className="mt-1 text-[11px] text-muted">
        {src ? (src === "sim" ? "Simulated feed" : src === "occuspace" ? "Occuspace sensor" : "Union point of sale") : "No data in the last 30 min"}
        {head && ` · ${new Date(head.observed_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
      </p>

      <div className="mt-3 border-t border-line pt-3 text-sm">
        {v.reports.length > 0 ? (
          v.reports.map((r) => (
            <p key={r.metric} className="text-xs">
              Students report ~<b>{Math.round(r.median)}</b> {r.metric === "wait_min" ? "min wait" : "in line"} ({r.n} report{r.n > 1 ? "s" : ""}, last 30 min)
            </p>
          ))
        ) : (
          <p className="text-xs text-muted">No student reports in the last 30 min.</p>
        )}
        <div className="mt-1.5">
          <VenueReport venueId={v.venue_id} signedIn={signedIn} />
        </div>
      </div>

      <div className="mt-3 space-y-1.5 border-t border-line pt-3">
        {v.markets.length ? (
          v.markets.map((m) => (
            <Link key={m.market_id} href={`/markets/${m.market_id}`} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-panel-2">
              <span className="flex-1">{m.question}</span>
              <span className="tabular font-bold">{Math.round(m.yes * 100)}%</span>
            </Link>
          ))
        ) : (
          <p className="text-xs text-muted">No open markets right now. New ones open every morning.</p>
        )}
      </div>
    </section>
  );
}

/** Today's history as a tiny line (server-rendered SVG). */
function Sparkline({ points, max }: { points: { t: number; v: number }[]; max?: number }) {
  if (points.length < 2) return null;
  const W = 140;
  const H = 40;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const top = max ?? Math.max(...points.map((p) => p.v), 1);
  const d = points
    .map((p, i) => `${i ? "L" : "M"}${(((p.t - t0) / Math.max(1, t1 - t0)) * W).toFixed(1)},${(H - (p.v / top) * H).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ml-auto h-10 w-36" role="img" aria-label="Today so far">
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
    </svg>
  );
}
