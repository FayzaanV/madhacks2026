/** Small shared UI pieces for the board look. Server-safe (no hooks). */

const ICON_COLORS = ["#d2363a", "#e8772e", "#2f5fd0", "#7a4fc0", "#0e7490", "#be185d", "#4d7c0f", "#b45309"];

/** Stable fallback color for any key (course name, user id). */
export const colorFor = (key: string) => ICON_COLORS[[...key].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7) % ICON_COLORS.length];

/**
 * Subject color for a course / market topic. Each subject maps to a --subj-* token in globals.css,
 * so recoloring a subject is a one-line CSS change. Unknown courses fall back to a stable hashed color.
 */
const SUBJECTS: [RegExp, string][] = [
  [/^(econ|ec)\b/i, "var(--subj-econ)"],
  [/^(comp\s*sci|cs|cosci)\b/i, "var(--subj-cs)"],
  [/^(data\s*sci|ds)\b/i, "var(--subj-ds)"],
  [/^(stat|st)\s*\d/i, "var(--subj-stat)"],
  [/^(math|ma)\s*\d/i, "var(--subj-math)"],
  [/^(chem|ch)\s*\d/i, "var(--subj-chem)"],
  [/^(psych|ps)\b/i, "var(--subj-psych)"],
  [/^campus$/i, "var(--subj-campus)"],
  [/^IM\s/, "var(--subj-im)"],
];

export function subjectColor(course: string): string {
  if (course in SPORT_BADGE) return "var(--subj-sports)";
  const hit = SUBJECTS.find(([re]) => re.test(course.trim()));
  return hit ? hit[1] : colorFor(course);
}

/** Square course badge with initials, color by subject. */
const SPORT_BADGE: Record<string, string> = {
  Football: "FB", "Men's Basketball": "MBB", "Women's Basketball": "WBB", "Men's Hockey": "MHK",
  "Women's Hockey": "WHK", Volleyball: "VB",
};

export function CourseIcon({ course, size = 36 }: { course: string; size?: number }) {
  const label =
    course === "campus"
      ? "UW"
      : SPORT_BADGE[course] ?? (course.startsWith("IM ") ? "IM" : null) ?? course
          .replace(/[^A-Za-z0-9 ]/g, "")
          .split(" ")
          .map((w, i) => (i === 0 ? w.slice(0, 2) : w.slice(0, 3)))
          .join("")
          .slice(0, 5)
          .toUpperCase();
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-lg font-bold text-white"
      style={{ width: size, height: size, background: subjectColor(course), fontSize: size * 0.28 }}
      aria-hidden
    >
      {label}
    </span>
  );
}

/** Half-ring probability gauge for binary markets. Green at 50%+, slate below. */
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
