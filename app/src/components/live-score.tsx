"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { GameBadge } from "@/server/markets";

type Row = { state: GameBadge["state"]; detail: string | null; home_abbr: string; away_abbr: string; home_score: number | null; away_score: number | null };

/**
 * Score panel on sports/intramural market pages. Sports games re-poll /api/sports/games/:id every 30 s while
 * live; when the game goes final the page refreshes so the auto-resolution shows up.
 */
export function LiveScore({
  initial,
  eventId,
  market,
}: {
  initial: GameBadge;
  eventId: string | null;
  market: { kind: string | null; resolved: boolean; closesAt: string; openingNote: string | null; liveOdds: boolean };
}) {
  const router = useRouter();
  const [g, setG] = useState(initial);
  useEffect(() => {
    if (g.kind !== "sports" || !eventId || g.state === "post") return;
    const id = setInterval(async () => {
      const res = await fetch(`/api/sports/games/${eventId}`, { cache: "no-store" }).catch(() => null);
      if (!res?.ok) return;
      const r = (await res.json()).game as Row;
      setG((prev) => ({ ...prev, state: r.state, detail: r.detail, home_score: r.home_score, away_score: r.away_score }));
      if (r.state === "post") setTimeout(() => router.refresh(), 70_000); // after the poller settles it
    }, 30_000);
    return () => clearInterval(id);
  }, [g.kind, g.state, eventId, router]);

  const live = g.state === "in";
  const tradesLive = Date.parse(market.closesAt) > Date.parse(g.starts_at) + 60_000;
  return (
    <section className={`rounded-2xl border p-4 ${live ? "border-no/40" : "border-line"} bg-panel`}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
        {live ? (
          <span className="flex items-center gap-1.5 text-no"><i className="inline-block h-2 w-2 animate-pulse rounded-full bg-no" /> Live</span>
        ) : (
          <span className="text-muted">{g.state === "post" ? "Final" : "Upcoming"}</span>
        )}
        <span className="text-muted">· {g.kind === "sports" ? "ESPN" : "Intramural"}</span>
      </div>
      <div className="tabular mt-2 grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-1 text-lg">
        <span className="font-semibold">{g.away}</span><b className="text-2xl">{g.away_score ?? "–"}</b>
        <span className="font-semibold">{g.home} <span className="text-xs font-normal text-muted">home</span></span><b className="text-2xl">{g.home_score ?? "–"}</b>
      </div>
      <p className="mt-2 text-xs text-muted">
        {g.state === "pre"
          ? `Starts ${new Date(g.starts_at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })} CT · ${tradesLive ? "trades live during the game" : "trading closes at the start"}`
          : g.detail}
      </p>
      {market.openingNote && <p className="mt-1 text-xs text-muted">{market.openingNote}</p>}
      {tradesLive && !market.resolved && (
        <p className="mt-1 text-xs font-medium text-accent">
          {market.kind === "winner" && market.liveOdds
            ? "Live trading: the price follows ESPN's live win probability every minute until the final whistle."
            : market.kind === "total"
              ? "Live trading: settles Over the moment the combined score passes the line."
              : "Live trading until the final whistle."}
        </p>
      )}
      {!market.resolved && (
        <p className="mt-3 rounded-lg bg-panel-2 p-2 text-xs text-muted">
          {g.kind === "sports"
            ? "Auto-resolves from ESPN's final score within a minute or two of the final whistle. Postponed or canceled games are voided and every stake is refunded."
            : "Resolves when one captain reports the score and the other confirms (or 2 hours pass with no dispute). Disputes go to an admin."}
        </p>
      )}
    </section>
  );
}
