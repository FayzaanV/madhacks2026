"use client";

import { TimeChart } from "./time-chart";

/** A Union market's metric around its settlement window, with the threshold as a dashed line. */
export function RuleChart({ series, threshold, unit }: { series: { t: number; v: number }[]; threshold: number; unit: string }) {
  if (series.length < 2) return <p className="py-6 text-center text-sm text-muted">No readings around this window yet.</p>;
  return (
    <TimeChart
      height={180}
      format={(v) => `${Math.round(v)}${unit}`}
      series={[
        { key: "metric", label: "Reading", color: "var(--accent)", points: series },
        { key: "threshold", label: "Threshold", color: "var(--no)", dashed: true, points: series.map((p) => ({ t: p.t, v: threshold })) },
      ]}
    />
  );
}
