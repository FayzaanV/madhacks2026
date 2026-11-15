import { describeRule, type AutoRule } from "@/core/auto-rules";
import { latestFacilities, typicalCrowd } from "@/server/campus-data";
import { CampusSyncButton } from "./campus-sync-button";

/** "How this resolves" for weather / rec-center markets, with the live count and the typical crowd from gold. */
export async function AutoRulePanel({ ruleJson, settled, admin }: { ruleJson: string; settled: boolean; admin: boolean }) {
  let rule: AutoRule;
  try {
    rule = JSON.parse(ruleJson) as AutoRule;
  } catch {
    return null;
  }
  let live: string | null = null;
  let typical: string | null = null;
  if (rule.kind === "facility" && !settled) {
    const [now, avg] = await Promise.all([
      latestFacilities().then((fs) => fs.find((f) => f.location_id === rule.location_id)).catch(() => undefined),
      typicalCrowd(rule),
    ]);
    if (now) {
      const pct = now.capacity ? Math.round((100 * now.last_count) / now.capacity) : 0;
      const when = new Date(now.source_updated_at).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });
      live = now.is_closed ? "Closed right now." : `Right now: ${now.last_count} of ${now.capacity} people (${pct}% full), updated ${when}.`;
    }
    if (avg && avg.n >= 3)
      typical = `Typical for that weekday and hour: about ${Math.round(avg.avg_count)} people (${Math.round(avg.avg_pct)}% full), from ${avg.n} past counts.`;
  }
  return (
    <section className="rounded-2xl border border-accent/40 bg-panel p-4 text-sm">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">How this resolves</h2>
        <span className="rounded bg-accent-soft px-1.5 py-0.5 text-xs font-semibold text-accent">
          Auto · {rule.kind === "weather" ? "Open-Meteo" : "UW Rec Well live counts"}
        </span>
      </div>
      <p className="mt-1">{describeRule(rule)}</p>
      {live && <p className="mt-2 text-muted">{live}</p>}
      {typical && <p className="mt-1 text-muted">{typical} <span className="text-xs">(gold.facility_busyness on Databricks)</span></p>}
      {admin && !settled && <CampusSyncButton />}
    </section>
  );
}
