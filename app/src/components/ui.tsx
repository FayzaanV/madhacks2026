/** Small shared UI pieces for the board look. Server-safe (no hooks). */

const ICON_COLORS = ["#7c3aed", "#9333ea", "#c026d3", "#6366f1", "#8b5cf6", "#a855f7", "#4f46e5", "#db2777"];

/** Square course badge with initials, color hashed from the course name. */
export function CourseIcon({ course, size = 36 }: { course: string; size?: number }) {
  const hash = [...course].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const label =
    course === "campus"
      ? "UW"
      : course
          .replace(/[^A-Za-z0-9 ]/g, "")
          .split(" ")
          .map((w, i) => (i === 0 ? w.slice(0, 2) : w.slice(0, 3)))
          .join("")
          .slice(0, 5)
          .toUpperCase();
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-lg font-bold text-white"
      style={{ width: size, height: size, background: ICON_COLORS[hash % ICON_COLORS.length], fontSize: size * 0.28 }}
      aria-hidden
    >
      {label}
    </span>
  );
}

/** Half-ring probability gauge for binary markets. */
export function Gauge({ p, label = "chance" }: { p: number; label?: string }) {
  const r = 22;
  const c = Math.PI * r;
  const v = Math.max(0, Math.min(1, p));
  const color = v >= 0.5 ? "var(--yes)" : "var(--no)";
  return (
    <div className="relative flex w-14 flex-col items-center">
      <svg viewBox="0 0 56 32" className="w-14" aria-hidden>
        <path d="M6 28 A22 22 0 0 1 50 28" fill="none" stroke="var(--line)" strokeWidth="5" strokeLinecap="round" />
        <path
          d="M6 28 A22 22 0 0 1 50 28"
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${c * v} ${c}`}
        />
      </svg>
      <span className="tabular -mt-3 text-sm font-bold">{Math.round(v * 100)}%</span>
      <span className="text-[10px] leading-none text-muted">{label}</span>
    </div>
  );
}

export const fmtClout = (v: number) =>
  v >= 1000 ? `${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}K` : `${Math.round(v)}`;
