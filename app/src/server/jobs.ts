import "server-only";
import { dbx } from "./databricks";

/**
 * Kick off the `yomi-refresh` job (Lakebase -> bronze -> silver/gold -> AI insights) so leaderboards and
 * profiles catch up right after a resolution instead of waiting for the 15-minute schedule.
 * On Databricks Apps REFRESH_JOB_ID comes from the app's job resource; locally we look the job up by name.
 * Best effort: a failed trigger never fails the resolution, the schedule catches up anyway.
 */
const JOB_NAME = process.env.REFRESH_JOB_NAME ?? "yomi-refresh";
let jobId: number | null = process.env.REFRESH_JOB_ID ? Number(process.env.REFRESH_JOB_ID) : null;

async function refreshJobId(): Promise<number | null> {
  if (jobId) return jobId;
  const r = await dbx<{ jobs?: { job_id: number }[] }>(`/api/2.2/jobs/list?name=${encodeURIComponent(JOB_NAME)}&limit=1`);
  jobId = r.jobs?.[0]?.job_id ?? null;
  return jobId;
}

export async function triggerRefresh(): Promise<number | null> {
  try {
    const id = await refreshJobId();
    if (!id) {
      console.warn(`refresh job "${JOB_NAME}" not found; gold will update on the next scheduled run`);
      return null;
    }
    const r = await dbx<{ run_id: number }>("/api/2.2/jobs/run-now", { method: "POST", body: JSON.stringify({ job_id: id }) });
    return r.run_id;
  } catch (e) {
    console.error("refresh job trigger failed", e);
    return null;
  }
}
