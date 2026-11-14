type Point = { t: number; crowd: number; smart: number | null };

/** Crowd price (solid violet) vs Smart Money (dashed magenta). Server-rendered SVG. */
export function PriceChart({ points, height = 220 }: { points: Point[]; height?: number }) {
  if (points.length < 2) return <p className="py-16 text-center text-sm text-muted">Not enough trades yet.</p>;
  const W = 640;
  const H = height;
  const padL = 8;
  const padR = 40;
  const padY = 14;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t || t0 + 1;
  const x = (t: number) => padL + ((t - t0) / Math.max(1, t1 - t0)) * (W - padL - padR);
  const y = (p: number) => H - padY - p * (H - padY * 2);
  const path = (get: (p: Point) => number | null) =>
    points
      .filter((p) => get(p) != null)
      .map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(get(p)!).toFixed(1)}`)
      .join(" ");
  const last = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Price history: crowd vs Smart Money">
      {[0, 0.25, 0.5, 0.75, 1].map((g) => (
        <g key={g}>
          <line x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} stroke="var(--line)" strokeDasharray="2 4" />
          <text x={W - padR + 6} y={y(g) + 4} fontSize="11" fill="var(--muted)">
            {g * 100}%
          </text>
        </g>
      ))}
      <path d={path((p) => p.smart)} fill="none" stroke="var(--smart)" strokeWidth="2" strokeDasharray="6 4" />
      <path d={path((p) => p.crowd)} fill="none" stroke="var(--accent)" strokeWidth="2.5" />
      <circle cx={x(last.t)} cy={y(last.crowd)} r="4" fill="var(--accent)" />
      {last.smart != null && <circle cx={x(last.t)} cy={y(last.smart)} r="4" fill="var(--smart)" />}
    </svg>
  );
}
