import { privileges } from "@/core/clout";
import { UNIVERSITIES } from "@/core/universities";
import Link from "next/link";
import { overallRank } from "@/server/leaderboard";
import { querySql } from "@/server/warehouse";
import { displayTitle } from "@/core/titles";
import { Avatar } from "./avatar";
import { Clout } from "./clout";

type Stats = { school_id: string | null; clout: number; open_stake: number; n_trades: number; n_markets: number; brier: number | null };
type Bin = { bucket: number; n: number; mean_forecast: number; hit_rate: number };

/** Profile built from gold tables: Clout, Brier, calibration curve, flair. */
export async function Profile({
  userId,
  handle,
  liveClout,
  title,
  avatarV,
}: {
  userId: string;
  handle: string;
  liveClout?: number;
  title?: string | null;
  avatarV?: number | null;
}) {
  const [stats, bins, flair, rank] = await Promise.all([
    querySql<Stats>(
      `SELECT c.school_id, c.clout, c.open_stake, c.n_trades, c.n_markets, b.brier
       FROM {catalog}.gold.user_clout c
       LEFT JOIN {catalog}.gold.user_brier b USING (user_id)
       WHERE c.user_id = :id`,
      { id: userId },
    ),
    querySql<Bin>(
      "SELECT bucket, n, mean_forecast, hit_rate FROM {catalog}.gold.user_calibration WHERE user_id = :id ORDER BY bucket",
      { id: userId },
    ),
    querySql<{ flair: string; kind: string }>("SELECT flair, kind FROM {catalog}.gold.user_flair WHERE user_id = :id", { id: userId }),
    overallRank(userId), // live from Lakebase
  ]);
  const s = stats[0];
  const clout = liveClout ?? s?.clout ?? 0;
  const total = bins.reduce((a, b) => a + b.n, 0);
  const calErr = total ? bins.reduce((a, b) => a + b.n * Math.abs(b.mean_forecast - b.hit_rate), 0) / total : null;

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end gap-4">
        <Avatar userId={userId} handle={handle} v={avatarV} size={80} />
        <div>
          <h1 className="text-2xl font-bold">@{handle}</h1>
          <div className="text-sm font-semibold text-accent">{displayTitle(title, clout, flair.map((f) => f.flair))}</div>
          {s?.school_id && (
            <Link href={`/leaderboard?scope=school&value=${encodeURIComponent(s.school_id)}`} className="text-sm text-muted hover:text-accent">
              {UNIVERSITIES.find((u) => u.school_id === s.school_id)?.name ?? s.school_id.replace(/^edu-/, "")}
            </Link>
          )}
          <div className="mt-1 flex flex-wrap gap-1.5">
            {flair.map((f) => (
              <span key={f.flair} className={`rounded px-2 py-0.5 text-xs font-medium ${f.kind === "oracle" ? "bg-yes-soft text-yes" : "bg-no-soft text-no"}`}>
                {f.flair}
              </span>
            ))}
          </div>
        </div>
        <div className="ml-auto text-3xl"><Clout value={clout} /></div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Overall rank" value={rank ? `#${rank}` : "–"} />
        <Stat label="Brier score" value={s?.brier != null ? s.brier.toFixed(3) : "–"} hint="lower is better" />
        <Stat label="Trades" value={s ? `${s.n_trades} in ${s.n_markets} markets` : "0"} />
        <Stat label="Can" value={privileges(clout).join(", ")} />
      </section>

      <section className="rounded-2xl border border-line bg-panel p-4">
        <h2 className="font-semibold">Calibration</h2>
        <p className="text-sm text-muted">
          {calErr == null
            ? "No resolved forecasts yet. Calibration appears once your markets resolve."
            : `When you say X%, you're off by ${Math.round(calErr * 100)} points on average (${total} resolved forecasts).`}
        </p>
        {bins.length > 0 && <CalibrationChart bins={bins} />}
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="tabular mt-0.5 font-semibold">{value}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </div>
  );
}

function CalibrationChart({ bins }: { bins: Bin[] }) {
  const S = 260;
  const pad = 28;
  const p = (v: number) => pad + v * (S - pad * 2);
  const yy = (v: number) => S - pad - v * (S - pad * 2);
  const maxN = Math.max(...bins.map((b) => b.n));
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="mt-3 w-full max-w-sm" role="img" aria-label="Calibration: forecast vs hit rate">
      <line x1={p(0)} y1={yy(0)} x2={p(1)} y2={yy(1)} stroke="var(--line)" strokeDasharray="4 3" />
      <line x1={p(0)} y1={yy(0)} x2={p(1)} y2={yy(0)} stroke="var(--muted)" />
      <line x1={p(0)} y1={yy(0)} x2={p(0)} y2={yy(1)} stroke="var(--muted)" />
      <text x={S / 2} y={S - 6} fontSize="10" textAnchor="middle" fill="var(--muted)">your forecast</text>
      <text x={10} y={S / 2} fontSize="10" textAnchor="middle" fill="var(--muted)" transform={`rotate(-90 10 ${S / 2})`}>how often right</text>
      {bins.map((b) => (
        <circle key={b.bucket} cx={p(b.mean_forecast)} cy={yy(b.hit_rate)} r={3 + 6 * Math.sqrt(b.n / maxN)} fill="var(--accent)" fillOpacity="0.75" />
      ))}
    </svg>
  );
}
