"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Admin tools for simulated [Test] markets: create a batch closing tonight, or settle every closed one now. */
export function TestMarketTools() {
  const router = useRouter();
  const [count, setCount] = useState(8);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(path: string, body?: object) {
    setBusy(true);
    setMsg(null);
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: j.error ?? "Something went wrong." });
    setMsg({
      ok: true,
      text: j.created ? `Created ${j.created.length} test markets with simulated trading. They're on the home page.` : `Settled ${j.settled} closed test markets.`,
    });
    router.refresh();
  }

  return (
    <section className="space-y-3 rounded-2xl border border-dashed border-line bg-panel p-5 text-sm">
      <h2 className="font-semibold">Test markets</h2>
      <p className="text-muted">
        Simulated <b>[Test]</b> markets that close tonight (Madison time), get bets from simulated users, and resolve at random
        (weighted by the odds at close). Resolve one early or override the result from its page.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={1}
          max={12}
          value={count}
          onChange={(e) => setCount(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
          className="w-16 rounded-lg border border-line bg-bg px-2 py-1.5"
          aria-label="How many test markets"
        />
        <button disabled={busy} onClick={() => run("/api/admin/test-markets", { count })} className="rounded-lg bg-accent px-3 py-1.5 font-semibold text-accent-ink disabled:opacity-50">
          {busy ? "Working…" : "Create test markets closing tonight"}
        </button>
        <button disabled={busy} onClick={() => run("/api/admin/test-markets/settle")} className="rounded-lg border border-line px-3 py-1.5 font-semibold disabled:opacity-50">
          Resolve all closed test markets now
        </button>
      </div>
      {msg && <p className={msg.ok ? "text-yes" : "text-no"}>{msg.text}</p>}
    </section>
  );
}
