import "server-only";
import { dbx, localMode } from "./databricks";

/**
 * Ask for a `yomi-refresh` run (Lakebase -> bronze -> silver/gold -> AI insights) so leaderboards catch up after a
 * person resolves a market, instead of waiting for the schedule. Budget guards, because one run per resolution
 * plus a queue exhausted the Free Edition compute quota:
 *   - at most one app-triggered run per 30 minutes (per server)
 *   - never while a run is already active or queued
 *   - OFF unless REFRESH_ON_RESOLVE=1: by default leaderboards refresh only manually (scripts/cloud.sh refresh)
 * Best effort: a skipped or failed trigger never fails the resolution; the schedule catches up.
 */
const JOB_NAME = process.env.REFRESH_JOB_NAME ?? "yomi-refresh";
const COOLDOWN_MS = 30 * 60e3;
let jobId: number | null = process.env.REFRESH_JOB_ID ? Number(process.env.REFRESH_JOB_ID) : null;
let lastTriggered = 0;

async function refreshJobId(): Promise<number | null> {
  if (jobId) return jobId;
  const r = await dbx<{ jobs?: { job_id: number }[] }>(`/api/2.2/jobs/list?name=${encodeURIComponent(JOB_NAME)}&limit=1`);
  jobId = r.jobs?.[0]?.job_id ?? null;
  return jobId;
}

export async function triggerRefresh(): Promise<number | null> {
  if (process.env.REFRESH_ON_RESOLVE !== "1" || localMode()) return null;
  if (Date.now() - lastTriggered < COOLDOWN_MS) return null;
  try {
    const id = await refreshJobId();
    if (!id) {
      console.warn(`refresh job "${JOB_NAME}" not found; gold will update on the next scheduled run`);
      return null;
    }
    const active = await dbx<{ runs?: unknown[] }>(`/api/2.2/jobs/runs/list?job_id=${id}&active_only=true&limit=1`);
    if (active.runs?.length) return null;
    lastTriggered = Date.now();
    const r = await dbx<{ run_id: number }>("/api/2.2/jobs/run-now", { method: "POST", body: JSON.stringify({ job_id: id }) });
    return r.run_id;
  } catch (e) {
    console.error("refresh job trigger failed", e);
    return null;
  }
}
