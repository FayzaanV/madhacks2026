"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** "I'm here" check-in: report the current wait or line length at a venue. */
export function VenueReport({ venueId, signedIn }: { venueId: string; signedIn: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [metric, setMetric] = useState<"wait_min" | "line_len">("wait_min");
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!signedIn) return <a href="/login" className="text-xs font-semibold text-accent">Sign in to report the wait</a>;
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="text-xs font-semibold text-accent">
        I&apos;m here: report the wait
      </button>
    );
  return (
    <form
      className="flex flex-wrap items-center gap-2 text-xs"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await fetch(`/api/venues/${venueId}/reports`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ metric, value: Number(value) }),
        });
        const j = await res.json().catch(() => ({}));
        setMsg(res.ok ? { ok: true, text: "Thanks! Counted." } : { ok: false, text: j.error ?? "Couldn't save." });
        if (res.ok) {
          setValue("");
          router.refresh();
        }
      }}
    >
      <select value={metric} onChange={(e) => setMetric(e.target.value as "wait_min" | "line_len")} className="rounded-md border border-line bg-bg px-2 py-1">
        <option value="wait_min">Wait (minutes)</option>
        <option value="line_len">People in line</option>
      </select>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
        inputMode="numeric"
        required
        className="w-16 rounded-md border border-line bg-bg px-2 py-1"
        aria-label="Value"
      />
      <button className="rounded-md bg-accent px-2 py-1 font-semibold text-accent-ink">Report</button>
      {msg && <span className={msg.ok ? "text-yes" : "text-no"}>{msg.text}</span>}
    </form>
  );
}
