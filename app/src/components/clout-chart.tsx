"use client";

import { TimeChart } from "./time-chart";

/** True Clout over time (gold user_clout_history) with today's live value as the last point. */
export function CloutChart({ points }: { points: { t: number; clout: number }[] }) {
  return (
    <TimeChart
      series={[{ key: "clout", label: "Clout", color: "var(--accent)", points: points.map((p) => ({ t: p.t, v: p.clout })) }]}
      format={(v) => Math.round(v).toLocaleString()}
      height={220}
      header={(values, t, start) => {
        const v = values[0];
        const d = v != null && start[0] != null ? v - start[0] : null;
        return (
          <div>
            <div className={`tabular text-3xl font-bold ${v != null && v < 0 ? "text-no" : ""}`}>
              {v == null ? "–" : v.toLocaleString(undefined, { maximumFractionDigits: 1 })}{" "}
              <span className="text-base font-medium text-muted">Clout</span>
            </div>
            {d != null && (
              <div className={`text-xs font-semibold ${d > 0 ? "text-yes" : d < 0 ? "text-no" : "text-muted"}`}>
                {d > 0 ? "▲ +" : d < 0 ? "▼ " : ""}
                {d.toFixed(1)} {t == null ? "this range" : "since range start"}
              </div>
            )}
          </div>
        );
      }}
    />
  );
}
