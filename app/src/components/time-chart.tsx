"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";

export type Series = { key: string; label: string; color: string; dashed?: boolean; points: { t: number; v: number | null }[] };

const RANGES = [
  { id: "1H", ms: 3600e3 },
  { id: "6H", ms: 6 * 3600e3 },
  { id: "1D", ms: 86400e3 },
  { id: "1W", ms: 7 * 86400e3 },
  { id: "1M", ms: 30 * 86400e3 },
  { id: "ALL", ms: Infinity },
] as const;
type RangeId = (typeof RANGES)[number]["id"];

/** Value of a step series at time t: the last point at or before t (prices hold until the next trade). */
function valueAt(points: Series["points"], t: number): number | null {
  let lo = 0;
  let hi = points.length - 1;
  if (hi < 0 || points[0].t > t) return null;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return points[lo].v;
}

const fmtTime = (t: number) =>
  new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Kalshi-style history chart: range buttons, a hover crosshair, and a slider to scrub through time.
 * `header` renders above the chart with the values at the scrubbed time (or now).
 */
export function TimeChart({
  series,
  domain,
  format,
  height = 260,
  header,
}: {
  series: Series[];
  domain?: [number, number];
  format: (v: number) => string;
  height?: number;
  header?: (values: (number | null)[], t: number | null, start: (number | null)[]) => ReactNode;
}) {
  const all = series.flatMap((s) => s.points.map((p) => p.t));
  const tMin = all.length ? Math.min(...all) : 0;
  const tMax = all.length ? Math.max(...all) : 1;
  const available = RANGES.filter((r) => r.ms === Infinity || tMax - tMin > r.ms / 4);
  const [range, setRange] = useState<RangeId>("ALL");
  const [scrub, setScrub] = useState<number | null>(null); // time, or null = now
  const svg = useRef<SVGSVGElement>(null);

  const span = RANGES.find((r) => r.id === range)!.ms;
  const t0 = span === Infinity ? tMin : Math.max(tMin, tMax - span);
  const t1 = Math.max(tMax, t0 + 1);

  const W = 640;
  const H = height;
  const padL = 8;
  const padR = 48;
  const padY = 14;
  const x = (t: number) => padL + ((t - t0) / (t1 - t0)) * (W - padL - padR);

  const [lo, hi] = useMemo(() => {
    if (domain) return domain;
    const vs = series.flatMap((s) => s.points.filter((p) => p.t >= t0 && p.v != null).map((p) => p.v!));
    for (const s of series) {
      const v = valueAt(s.points, t0);
      if (v != null) vs.push(v);
    }
    if (!vs.length) return [0, 1];
    const a = Math.min(...vs);
    const b = Math.max(...vs);
    const pad = Math.max((b - a) * 0.12, Math.abs(b) * 0.02, 1);
    return [a - pad, b + pad];
  }, [domain, series, t0]);
  const y = (v: number) => H - padY - ((v - lo) / (hi - lo || 1)) * (H - padY * 2);

  /** Step path over the visible window, starting from the value carried in from before t0. */
  const path = (s: Series) => {
    const pts = s.points.filter((p) => p.t > t0 && p.v != null);
    const start = valueAt(s.points, t0);
    const seq = [...(start != null ? [{ t: t0, v: start }] : []), ...pts] as { t: number; v: number }[];
    if (!seq.length) return "";
    let d = `M${x(seq[0].t).toFixed(1)},${y(seq[0].v).toFixed(1)}`;
    for (let i = 1; i < seq.length; i++) d += `H${x(seq[i].t).toFixed(1)}V${y(seq[i].v).toFixed(1)}`;
    return d + `H${x(t1).toFixed(1)}`;
  };

  const at = scrub == null ? t1 : Math.min(t1, Math.max(t0, scrub));
  const values = series.map((s) => valueAt(s.points, at));
  const startValues = series.map((s) => valueAt(s.points, t0) ?? s.points.find((p) => p.v != null)?.v ?? null);
  const ticks = domain
    ? [0, 0.25, 0.5, 0.75, 1].map((f) => lo + f * (hi - lo))
    : [0, 0.5, 1].map((f) => lo + f * (hi - lo));

  const onPointer = (e: React.PointerEvent) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    setScrub(t0 + ((px - padL) / (W - padL - padR)) * (t1 - t0));
  };

  if (all.length < 2) return <p className="py-16 text-center text-sm text-muted">Not enough history yet.</p>;

  return (
    <div>
      {header?.(values, scrub == null ? null : at, startValues)}
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2 w-full touch-none select-none"
        role="img"
        aria-label={`History chart: ${series.map((s) => s.label).join(", ")}`}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={() => setScrub(null)}
      >
        {ticks.map((g) => (
          <g key={g}>
            <line x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} stroke="var(--line)" strokeDasharray="2 4" />
            <text x={W - padR + 6} y={y(g) + 4} fontSize="11" fill="var(--muted)">
              {format(g)}
            </text>
          </g>
        ))}
        {series.map((s) => (
          <path
            key={s.key}
            d={path(s)}
            fill="none"
            stroke={s.color}
            strokeWidth={s.dashed ? 2 : 2.5}
            strokeDasharray={s.dashed ? "6 4" : undefined}
            strokeLinejoin="round"
          />
        ))}
        <line x1={x(at)} x2={x(at)} y1={padY} y2={H - padY} stroke="var(--muted)" strokeOpacity={scrub == null ? 0 : 0.6} />
        {series.map((s, i) =>
          values[i] == null ? null : <circle key={s.key} cx={x(at)} cy={y(values[i]!)} r="4" fill={s.color} />,
        )}
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(((at - t0) / (t1 - t0)) * 1000)}
          onChange={(e) => {
            const v = Number(e.target.value);
            setScrub(v >= 1000 ? null : t0 + (v / 1000) * (t1 - t0));
          }}
          className="min-w-40 flex-1 accent-[var(--accent)]"
          aria-label="Scrub through history"
          aria-valuetext={scrub == null ? "now" : fmtTime(at)}
        />
        <span className="tabular w-36 text-right text-xs text-muted">{scrub == null ? "Now" : fmtTime(at)}</span>
        <div className="flex gap-0.5" role="group" aria-label="Time range">
          {available.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                setRange(r.id);
                setScrub(null);
              }}
              className={`rounded-md px-2 py-1 text-xs font-semibold ${range === r.id ? "bg-accent-soft text-accent" : "text-muted hover:text-ink"}`}
            >
              {r.id}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
