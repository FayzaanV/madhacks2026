"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { applyTrade } from "@/core/lmsr";
import { usePick } from "./trade-context";

type Props = {
  marketId: string;
  question: string;
  binary: boolean;
  outcomes: { index: number; label: string; price: number }[];
  liquidityB: number;
  qShares: number[];
  remaining: number;
  limit: number;
};

/** Trade panel: pick an outcome, choose Clout, preview with the shared LMSR core, place the bet. */
export function BetBox({ marketId, question, binary, outcomes, liquidityB, qShares, remaining, limit }: Props) {
  const router = useRouter();
  const { pick, setPick } = usePick();
  const [amount, setAmount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const chosen = outcomes[pick] ?? outcomes[0];

  const preview = useMemo(
    () => (amount > 0 ? applyTrade(qShares, chosen.index, amount, liquidityB) : null),
    [qShares, chosen.index, amount, liquidityB],
  );

  async function submit() {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/markets/${marketId}/trade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome: chosen.index, amount }),
    });
    const j = await res.json();
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: j.error });
    setMsg({
      ok: true,
      text: `Bought ${j.shares.toFixed(1)} shares of ${chosen.label}. Price ${Math.round(j.priceBefore * 100)}% → ${Math.round(j.priceAfter * 100)}%.`,
    });
    setAmount(0);
    router.refresh();
  }

  const add = (v: number) => setAmount((a) => Math.min(Math.round((a + v) * 10) / 10, Math.floor(remaining * 10) / 10));

  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <p className="line-clamp-2 text-sm text-muted">{question}</p>
      <p className="mt-0.5 font-semibold">
        Betting on <span className="text-accent">{chosen.label}</span>
      </p>

      {binary ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {outcomes.map((o) => {
            const on = pick === o.index;
            const yes = o.index === 0;
            return (
              <button
                key={o.index}
                onClick={() => setPick(o.index)}
                className={`rounded-xl py-3 font-semibold ${
                  on ? (yes ? "bg-yes text-white" : "bg-no text-white") : "bg-panel-2 text-muted hover:text-ink"
                }`}
              >
                {o.label} {Math.round(o.price * 100)}%
              </button>
            );
          })}
        </div>
      ) : (
        <select
          value={pick}
          onChange={(e) => setPick(Number(e.target.value))}
          className="mt-3 w-full rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-sm"
        >
          {outcomes.map((o) => (
            <option key={o.index} value={o.index}>
              {o.label} · {Math.round(o.price * 100)}%
            </option>
          ))}
        </select>
      )}

      <div className="mt-5 flex items-end justify-between">
        <div>
          <div className="font-medium">Amount</div>
          <div className="text-xs text-muted">
            {remaining.toFixed(1)} of {limit.toFixed(1)} left here
          </div>
        </div>
        <label className="flex items-baseline gap-1">
          <input
            type="number"
            inputMode="decimal"
            min={0}
            value={amount || ""}
            placeholder="0"
            onChange={(e) => setAmount(Number(e.target.value))}
            className="tabular w-28 bg-transparent text-right text-4xl font-bold outline-none placeholder:text-muted"
            aria-label="Clout to stake"
          />
          <span className="text-sm text-muted">Clout</span>
        </label>
      </div>
      <div className="mt-3 flex justify-end gap-1.5">
        {[1, 5, 10].map((v) => (
          <button key={v} onClick={() => add(v)} className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold hover:border-accent">
            +{v}
          </button>
        ))}
        <button
          onClick={() => setAmount(Math.floor(remaining * 10) / 10)}
          className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold hover:border-accent"
        >
          Max
        </button>
      </div>

      {preview && (
        <dl className="tabular mt-4 space-y-1 rounded-xl bg-panel-2 p-3 text-sm">
          <div className="flex justify-between"><dt className="text-muted">Shares</dt><dd>{preview.shares.toFixed(1)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Pays if right</dt><dd className="font-semibold text-yes">{preview.shares.toFixed(1)} Clout</dd></div>
          <div className="flex justify-between"><dt className="text-muted">New price</dt><dd>{Math.round(chosen.price * 100)}% → {Math.round(preview.postPrice * 100)}%</dd></div>
        </dl>
      )}

      <button
        disabled={busy || !(amount > 0)}
        onClick={submit}
        className="mt-4 w-full rounded-xl bg-accent py-3 font-semibold text-accent-ink transition hover:brightness-110 disabled:opacity-40"
      >
        {busy ? "Placing…" : amount > 0 ? `Bet ${amount} Clout` : "Enter an amount"}
      </button>
      {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-yes" : "text-no"}`}>{msg.text}</p>}
      <p className="mt-3 text-center text-xs text-muted">Max stake per market = max(10, 10% of your Clout). No real money.</p>
    </div>
  );
}
