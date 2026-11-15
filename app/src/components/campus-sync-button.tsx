"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Admins: run the campus-data poll now (save rec counts, settle due weather / rec-center markets). */
export function CampusSyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/campus/sync", { method: "POST" });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg(j.error ?? "Sync failed.");
    const waiting = (j.waiting ?? []).map((w: { reason: string }) => w.reason).join("; ");
    setMsg(`Saved ${j.facilityRowsSaved} new counts · settled ${j.resolved?.length ?? 0}${waiting ? ` · waiting: ${waiting}` : ""}${j.snapshotError ? ` · feed error: ${j.snapshotError}` : ""}`);
    router.refresh();
  }
  return (
    <div className="mt-3">
      <button onClick={run} disabled={busy} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold hover:border-accent disabled:opacity-50">
        {busy ? "Checking…" : "Check data now (admin)"}
      </button>
      {msg && <p className="mt-1 text-xs text-muted">{msg}</p>}
    </div>
  );
}
