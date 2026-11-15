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

export async function tick(): Promise<Record<string, unknown> | null> {
  if (running) return null;
  running = true;
  try {
    return await inBackground(async () => {
      if (!(await holdLease("sports"))) return { skipped: "another instance holds the lease" };
      const sports = await import("./sports");
      const im = await import("./intramurals");
      const out: Record<string, unknown> = {};
      if (Date.now() - lastSchedule > SCHEDULE_EVERY_MS) {
        out.scheduleGames = await sports.syncSchedules();
        lastSchedule = Date.now();
      }
      out.live = await sports.pollLive();
      out.created = await sports.createMarkets();
      out.settled = await sports.settleFinished();
      out.imAutoConfirmed = await im.autoConfirmDue();
      return out;
    });
  } catch (e) {
    console.error("[pollers] tick failed", String(e).slice(0, 300));
    return { error: String(e).slice(0, 300) };
  } finally {
    running = false;
  }
}

let started = false;
export function startPollers() {
  if (started || process.env.SPORTS_POLLER === "0") return;
  started = true;
  console.log(`[pollers] started as ${HOLDER}`);
  const run = () =>
    void tick().then((r) => {
      if (r && Object.keys(r).some((k) => k !== "skipped")) console.log("[pollers]", JSON.stringify(r));
    });
  setTimeout(run, 5_000);
  setInterval(run, TICK_MS).unref?.();
}
