import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { denyReason } from "@/core/intramurals";
import { AdminResultForm, CaptainPanel } from "@/components/im-forms";
import { currentUser } from "@/server/auth";
import { getGame } from "@/server/intramurals";
import { getMarket, isAdmin } from "@/server/markets";

export default function ImGamePage({ params }: PageProps<"/intramurals/[gameId]">) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl border border-line bg-panel" />}>
      <Game params={params} />
    </Suspense>
  );
}

async function Game({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const [g, user] = await Promise.all([getGame(gameId), currentUser()]);
  if (!g) notFound();
  const market = g.market_id ? await getMarket(g.market_id) : null;
  const isCaptain = user && [g.home_captain, g.away_captain].includes(user.user_id);
  const canReport = user && !denyReason(g, user.user_id, "report");
  const canRespond = user && !denyReason(g, user.user_id, "confirm");
  const reported = g.home_score != null ? `${g.away_name} ${g.away_score} – ${g.home_name} ${g.home_score}` : "";
  const done = ["final", "forfeit", "canceled"].includes(g.status);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href={`/intramurals?league=${g.league_id}`} className="text-sm text-muted hover:text-ink">← {g.sport} · {g.season}</Link>
      <section className="rounded-2xl border border-line bg-panel p-5">
        <div className="text-xs font-semibold uppercase text-muted">
          IM {g.sport} · {new Date(g.starts_at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })} CT
          {g.location ? ` · ${g.location}` : ""}
        </div>
        <div className="tabular mt-3 grid grid-cols-[1fr_auto] gap-y-1 text-xl">
          <span className="font-semibold">{g.away_name}</span><b>{g.away_score ?? "–"}</b>
          <span className="font-semibold">{g.home_name} <span className="text-xs font-normal text-muted">home</span></span><b>{g.home_score ?? "–"}</b>
        </div>
        <p className={`mt-2 text-sm font-semibold ${g.status === "disputed" ? "text-no" : done ? "text-yes" : "text-muted"}`}>
          {g.status === "reported" ? "Reported, awaiting the other captain" : g.status[0].toUpperCase() + g.status.slice(1)}
        </p>
        <p className="mt-1 text-xs text-muted">
          Captains: {g.away_name} @{g.away_captain_handle ?? "—"} · {g.home_name} @{g.home_captain_handle ?? "—"}
        </p>
      </section>

      {market && (
        <Link href={`/markets/${market.market_id}`} className="flex items-center justify-between rounded-2xl border border-line bg-panel p-4 hover:border-accent">
          <span className="font-medium">{market.question}</span>
          <span className="tabular text-lg font-bold">{Math.round(market.outcomes[0].price * 100)}% <span className="text-xs font-normal text-muted">Yes</span></span>
        </Link>
      )}

      {isCaptain && !done && (
        <section className="rounded-2xl border border-accent/40 bg-panel p-4">
          <h2 className="mb-2 font-semibold">Captain</h2>
          {canRespond ? (
            <CaptainPanel gameId={g.game_id} mode="respond" reported={reported} />
          ) : g.status === "reported" && g.reported_by === user!.user_id ? (
            <CaptainPanel gameId={g.game_id} mode="wait" reported={reported} />
          ) : canReport ? (
            <CaptainPanel gameId={g.game_id} mode="report" />
          ) : (
            <p className="text-sm text-muted">{denyReason(g, user!.user_id, "report")}</p>
          )}
        </section>
      )}

      {user && isAdmin(user) && !done && (
        <section className="rounded-2xl border border-line bg-panel p-4">
          <h2 className="mb-2 font-semibold">Admin decision</h2>
          <AdminResultForm gameId={g.game_id} />
        </section>
      )}
    </div>
  );
}
