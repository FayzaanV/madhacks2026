"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Resolver panel (500+ Clout): pick the winner or void, pays out and starts the Databricks refresh job. */
export function ResolveBox({ marketId, outcomes }: { marketId: string; outcomes: { index: number; label: string }[] }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<string>(String(outcomes[0]?.index ?? 0));
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form
      className="rounded-2xl border border-line bg-panel p-4 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        const label = outcome === "void" ? "void this market (refund everyone)" : `resolve as "${outcomes.find((o) => String(o.index) === outcome)?.label}"`;
        if (!confirm(`Really ${label}? Payouts happen immediately.`)) return;
        setBusy(true);
        setMsg(null);
        const res = await fetch(`/api/markets/${marketId}/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ outcome: outcome === "void" ? "void" : Number(outcome), rationale }),
        });
        const j = await res.json().catch(() => ({}));
        setBusy(false);
        if (!res.ok) return setMsg({ ok: false, text: j.error ?? "Resolution failed." });
        setMsg({
          ok: true,
          text: `Market ${j.status}. Paid ${Math.round(j.paidOut)} Clout to ${j.traders} traders.${j.refreshRunId ? " Databricks refresh started; leaderboards update in a few minutes." : ""}`,
        });
        router.refresh();
      }}
    >
      <h2 className="font-semibold">Resolve market</h2>
      <p className="mt-0.5 text-xs text-muted">You have 500+ Clout. Opens a 24h dispute window.</p>
      <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="mt-3 w-full rounded-lg border border-line bg-bg px-3 py-2">
        {outcomes.map((o) => (
          <option key={o.index} value={o.index}>
            {o.label} won
          </option>
        ))}
        <option value="void">Void (refund all stakes)</option>
      </select>
      <textarea
        value={rationale}
        onChange={(e) => setRationale(e.target.value)}
        maxLength={1000}
        rows={2}
        placeholder="Source / rationale (e.g. link to the announcement)"
        className="mt-2 w-full rounded-lg border border-line bg-bg px-3 py-2"
      />
      <button disabled={busy} className="mt-2 w-full rounded-lg bg-accent px-3 py-2 font-semibold text-accent-ink disabled:opacity-50">
        {busy ? "Resolving…" : "Resolve"}
      </button>
      {msg && <p className={`mt-2 ${msg.ok ? "text-yes" : "text-no"}`}>{msg.text}</p>}
    </form>
  );
}
