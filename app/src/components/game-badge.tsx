import Link from "next/link";
import type { GameBadge } from "@/server/markets";

/** Live/final score chip for sports and intramural markets: "● LIVE WIS 21 – MD 24 · 4th 2:10". */
export function GameBadgeChip({ g, size = "sm" }: { g: GameBadge; size?: "sm" | "md" }) {
  const live = g.state === "in";
  const text =
    g.state === "pre"
      ? new Date(g.starts_at).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }) + " CT"
      : `${g.away} ${g.away_score ?? "–"} – ${g.home} ${g.home_score ?? "–"}${g.detail ? ` · ${g.detail}` : ""}`;
  return (
    <Link
      href={g.link}
      className={`tabular inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-semibold ${
        size === "md" ? "text-sm" : "text-xs"
      } ${live ? "border-no/40 bg-no-soft text-no" : "border-line bg-panel-2 text-muted"}`}
    >
      {live && <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-no" aria-hidden />}
      {live ? "LIVE " : g.state === "post" ? "" : "Starts "}
      {text}
    </Link>
  );
}
