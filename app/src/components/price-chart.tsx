type Point = { t: number; crowd: number; smart: number | null };

/** Crowd price vs Smart Money line (server-rendered SVG, no chart library). */
export function PriceChart({ points }: { points: Point[] }) {
  if (points.length < 2) return <p className="py-16 text-center text-sm text-muted">Not enough trades yet.</p>;
  const W = 640;
  const H = 220;
  const pad = 28;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t || t0 + 1;
  const x = (t: number) => pad + ((t - t0) / Math.max(1, t1 - t0)) * (W - pad * 2);
  const y = (p: number) => H - pad - p * (H - pad * 2);
  const path = (get: (p: Point) => number | null) =>
    points
      .filter((p) => get(p) != null)
      .map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(get(p)!).toFixed(1)}`)
      .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Price history: crowd vs Smart Money">
      {[0, 0.25, 0.5, 0.75, 1].map((g) => (
        <g key={g}>
          <line x1={pad} x2={W - pad} y1={y(g)} y2={y(g)} stroke="var(--line)" />
          <text x={4} y={y(g) + 4} fontSize="10" fill="var(--muted)">
            {g * 100}%
          </text>
        </g>
      ))}
      <path d={path((p) => p.smart)} fill="none" stroke="var(--smart)" strokeWidth="2" strokeDasharray="5 3" />
      <path d={path((p) => p.crowd)} fill="none" stroke="var(--ink)" strokeWidth="2" />
    </svg>
  );
}
