"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { applyTrade } from "@/core/lmsr";

type Props = {
  marketId: string;
  outcomes: { index: number; label: string; price: number }[];
  liquidityB: number;
  qShares: number[];
  remaining: number;
  limit: number;
  clout: number;
};

export function BetBox({ marketId, outcomes, liquidityB, qShares, remaining, limit }: Props) {
  const router = useRouter();
  const [pick, setPick] = useState(0);
  const [amount, setAmount] = useState(Math.min(10, Math.floor(remaining)) || 10);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Same LMSR module the server uses, so the preview matches the fill.
  const preview = useMemo(
    () => (amount > 0 ? applyTrade(qShares, pick, amount, liquidityB) : null),
    [qShares, pick, amount, liquidityB],
  );

  async function submit() {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/markets/${marketId}/trade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome: pick, amount }),
    });
    const j = await res.json();
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: j.error });
    setMsg({
      ok: true,
      text: `Bought ${j.shares.toFixed(1)} shares. Price ${Math.round(j.priceBefore * 100)}% → ${Math.round(j.priceAfter * 100)}%.`,
    });
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <h2 className="font-semibold">Place a bet</h2>
      <div className="mt-3 grid gap-2">
        {outcomes.map((o) => (
          <button
            key={o.index}
            onClick={() => setPick(o.index)}
            className={`flex justify-between rounded-lg border px-3 py-2 text-sm ${
              pick === o.index ? "border-accent bg-accent/5" : "border-line"
            }`}
          >
            <span>{o.label}</span>
            <span className="tabular font-semibold">{Math.round(o.price * 100)}%</span>
          </button>
        ))}
      </div>
      <label className="mt-4 block text-sm">
        <span className="text-muted">Clout to stake</span>
        <input
          type="number"
          min={1}
          step={1}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          className="tabular mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2"
        />
      </label>
      <p className="mt-1 text-xs text-muted">
        {remaining.toFixed(1)} of {limit.toFixed(1)} left in this market (max(10, 10% of your Clout)).
      </p>
      {preview && (
        <p className="tabular mt-2 text-xs text-muted">
          You get {preview.shares.toFixed(1)} shares (pays {preview.shares.toFixed(1)} Clout if right). Price moves to{" "}
          {Math.round(preview.postPrice * 100)}%.
        </p>
      )}
      <button
        disabled={busy || amount <= 0}
        onClick={submit}
        className="mt-3 w-full rounded-lg bg-accent px-3 py-2 font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Placing…" : `Bet ${amount} Clout on ${outcomes[pick]?.label}`}
      </button>
      {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-yes" : "text-no"}`}>{msg.text}</p>}
    </div>
  );
}
