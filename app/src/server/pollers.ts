import "server-only";
import { inBackground } from "./background";
import { q } from "./ledger";

/**
 * Background pollers that run inside the app process (started from src/instrumentation.ts). The Databricks App
 * runs continuously and can reach ESPN, and settling uses the same TypeScript payout code as manual resolution.
 * A lease row in Lakebase (poller_leases) makes sure only one instance (deployed app or a local dev server) runs.
 */
const HOLDER = `${process.env.DATABRICKS_APP_NAME ?? "local"}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const TICK_MS = 60_000;
const SCHEDULE_EVERY_MS = 60 * 60_000;

async function holdLease(name: string): Promise<boolean> {
  const rows = await q<{ holder: string }>(
    `INSERT INTO poller_leases (name, holder, expires_at) VALUES ($1, $2, now() + interval '3 minutes')
     ON CONFLICT (name) DO UPDATE SET holder = EXCLUDED.holder, expires_at = EXCLUDED.expires_at
       WHERE poller_leases.holder = EXCLUDED.holder OR poller_leases.expires_at < now()
     RETURNING holder`,
    [name, HOLDER],
  );
  return rows[0]?.holder === HOLDER;
}

let lastSchedule = 0;
let running = false;

/** Can this instance reach ESPN? (Databricks Apps on Free Edition has no outbound internet.) */
async function espnReachable(): Promise<boolean> {
  try {
    const r = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/275", {
      headers: { "User-Agent": "Mozilla/5.0 (Yomi sports poller)" },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * One pass. Two independent leases:
 *  - "intramurals": auto-confirm overdue reports (only needs Lakebase, so the deployed app always can).
 *  - "sports": ESPN fetch + create + settle. Only taken by an instance that can reach ESPN, so an instance
 *    without internet (the Databricks App on Free Edition) never blocks one that has it (a teammate's machine).
 */
export async function tick(): Promise<Record<string, unknown> | null> {
  if (running) return null;
  running = true;
  try {
    return await inBackground(async () => {
      const out: Record<string, unknown> = {};
      if (await holdLease("intramurals")) {
        const im = await import("./intramurals");
        out.imAutoConfirmed = await im.autoConfirmDue();
        // Simulated test markets: settle closed ones and keep open ones moving (also pinged by /api/sim/tick).
        out.test = await (await import("./testmarkets")).simTick();
      }
      if (!(await espnReachable())) {
        out.sports = "skipped: ESPN not reachable from this instance";
        return out;
      }
      if (!(await holdLease("sports"))) {
        out.sports = "skipped: another instance holds the lease";
        return out;
      }
      const sports = await import("./sports");
      if (Date.now() - lastSchedule > SCHEDULE_EVERY_MS) {
        out.scheduleGames = await sports.syncSchedules();
        lastSchedule = Date.now();
      }
      out.live = await sports.pollLive();
      out.anchored = await sports.anchorLive();
      out.created = await sports.createMarkets();
      out.seeded = await sports.seedUntouched();
      out.settled = await sports.settleFinished();
      return out;
    });
  } catch (e) {
    console.error("[pollers] tick failed", String(e).slice(0, 300));
    return { error: String(e).slice(0, 300) };
  } finally {
    running = false;
  }
}

/**
 * Campus markets (server/campus-data.ts): save UW Rec Well counts and settle due weather / rec-center markets.
 * Runs in every instance without the lease: saving counts is idempotent and settling twice is refused, and the
 * point is that a laptop relay can save rec counts while the deployed app (no outbound internet on Free Edition)
 * holds the sports lease. Off with CAMPUS_POLLER=0.
 */
const CAMPUS_EVERY_MS = 5 * 60_000;
let campusRunning = false;
let campusFeedErrorLogged = false;

export async function campusTick() {
  if (campusRunning) return null;
  campusRunning = true;
  try {
    const r = await inBackground(async () => (await import("./campus-data")).pollOnce());
    if (r.snapshotError && !campusFeedErrorLogged) {
      console.log(`[campus] rec feed unreachable from this instance (${r.snapshotError}); the laptop relay saves counts`);
      campusFeedErrorLogged = true;
    }
    if (r.facilityRowsSaved || r.resolved.length || r.waiting.length) console.log("[campus]", JSON.stringify({ ...r, snapshotError: undefined }));
    return r;
  } catch (e) {
    console.error("[campus] tick failed", String(e).slice(0, 300));
    return null;
  } finally {
    campusRunning = false;
  }
}

let started = false;
export function startPollers() {
  if (started || process.env.SPORTS_POLLER === "0") return;
  started = true;
  console.log(`[pollers] started as ${HOLDER}`);
  const run = () =>
    void tick().then((r) => {
      // Log only passes that did something (or failed), not routine skips.
      if (r && (r.error || r.scheduleGames || r.created || r.settled || r.seeded || r.imAutoConfirmed)) console.log("[pollers]", JSON.stringify(r));
    });
  setTimeout(run, 5_000);
  setInterval(run, TICK_MS).unref?.();
  if (process.env.CAMPUS_POLLER !== "0") {
    setTimeout(() => void campusTick(), 15_000);
    setInterval(() => void campusTick(), CAMPUS_EVERY_MS).unref?.();
  }
}
