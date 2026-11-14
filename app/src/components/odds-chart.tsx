"use client";

import { TimeChart, type Series } from "./time-chart";

const PALETTE = ["var(--accent)", "#22c55e", "#f59e0b", "#38bdf8"];
const BINARY_COLORS = ["var(--yes)", "var(--no)"]; // Yes green, No red
const pct = (v: number | null) => (v == null ? "–" : `${Math.round(v * 100)}%`);

/**
 * Market odds over time. Crowd odds are live from the Lakebase ledger (every trade); the dashed Smart Money
 * line comes from the gold pipeline. Binary markets chart both Yes and No; multiple choice charts the top 4 outcomes.
 */
export function OddsChart({ labels, points }: { labels: string[]; points: { t: number; p: number[]; smart: number | null }[] }) {
  const binary = labels.length === 2;
  const last = points.at(-1)?.p ?? [];
  const shown = binary ? [0, 1] : labels.map((_, i) => i).sort((a, b) => (last[b] ?? 0) - (last[a] ?? 0)).slice(0, 4);
  const series: Series[] = shown.map((i, k) => ({
    key: `o${i}`,
    label: labels[i],
    color: binary ? BINARY_COLORS[k] : PALETTE[k],
    points: points.map((p) => ({ t: p.t, v: p.p[i] ?? null })),
  }));
  if (binary && points.some((p) => p.smart != null))
    series.push({ key: "smart", label: `Smart Money (${labels[0]})`, color: "var(--smart)", dashed: true, points: points.map((p) => ({ t: p.t, v: p.smart })) });

  return (
    <TimeChart
      series={series}
      domain={[0, 1]}
      format={(v) => `${Math.round(v * 100)}%`}
      header={(values, t, start) => {
        const move = values[0] != null && start[0] != null ? Math.round((values[0] - start[0]) * 100) : null;
        return (
          <div className="flex flex-wrap items-end gap-x-5 gap-y-1">
            <div>
              <div className="tabular text-3xl font-bold" style={{ color: series[0]?.color }}>
                {pct(values[0])} <span className="text-base font-medium text-muted">{binary ? "chance" : series[0]?.label}</span>
              </div>
              <div className={`text-xs font-semibold ${move == null || move === 0 ? "text-muted" : move > 0 ? "text-yes" : "text-no"}`}>
                {move == null ? "" : `${move > 0 ? "▲" : move < 0 ? "▼" : ""} ${Math.abs(move)} pts`} {t == null ? "this range" : "at scrubbed time"}
              </div>
            </div>
            {series.slice(1).map((s, k) => (
              <span key={s.key} className="flex items-center gap-1.5 text-sm">
                <i className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} /> {s.label}{" "}
                <b className="tabular">{pct(values[k + 1])}</b>
              </span>
            ))}
          </div>
        );
      }}
    />
  );
}
