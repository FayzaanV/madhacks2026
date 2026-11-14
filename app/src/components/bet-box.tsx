"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { applySell, applyTrade } from "@/core/lmsr";
import { usePick } from "./trade-context";

type Props = {
  marketId: string;
  question: string;
  binary: boolean;
  outcomes: { index: number; label: string; price: number }[];
  liquidityB: number;
  qShares: number[];
  available: number | null; // null = signed out
  holdings: number[]; // shares you hold per outcome
  initialSide?: "buy" | "sell";
};

/**
 * Trade panel. Buy: pick an outcome and a Clout amount. Sell: sell shares you hold back to the market maker.
 * Previews use the shared LMSR core, so they match what the server will fill.
 */
export function BetBox({ marketId, question, binary, outcomes, liquidityB, qShares, available, holdings, initialSide = "buy" }: Props) {
  const remaining = available ?? 0;
  const router = useRouter();
  const { pick, setPick } = usePick();
  const [side, setSide] = useState<"buy" | "sell">(initialSide);
  const [amount, setAmount] = useState(0); // Clout when buying, shares when selling
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const chosen = outcomes[pick] ?? outcomes[0];
  const held = holdings[chosen.index] ?? 0;
  const selling = side === "sell";
  const cap = selling ? held : (available ?? 0);

  const preview = useMemo(() => {
    if (!(amount > 0)) return null;
    if (selling) {
      const r = applySell(qShares, chosen.index, Math.min(amount, held), liquidityB);
      return { shares: Math.min(amount, held), clout: r.proceeds, postPrice: r.postPrice };
    }
    const r = applyTrade(qShares, chosen.index, amount, liquidityB);
    return { shares: r.shares, clout: amount, postPrice: r.postPrice };
  }, [qShares, chosen.index, amount, liquidityB, selling, held]);

  async function submit() {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/markets/${marketId}/trade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(selling ? { side: "sell", outcome: chosen.index, shares: amount } : { outcome: chosen.index, amount }),
    });
    const j = await res.json();
    setBusy(false);
    if (res.status === 401) return router.push("/login");
    if (!res.ok) return setMsg({ ok: false, text: j.error });
    const move = `Price ${Math.round(j.priceBefore * 100)}% → ${Math.round(j.priceAfter * 100)}%.`;
    setMsg({
      ok: true,
      text: selling
        ? `Sold ${j.shares.toFixed(1)} shares of ${chosen.label} for ${j.clout.toFixed(1)} Clout (${j.realized >= 0 ? "+" : ""}${j.realized.toFixed(1)} realized). ${move}`
        : `Bought ${j.shares.toFixed(1)} shares of ${chosen.label}. ${move}`,
    });
    setAmount(0);
    router.refresh();
  }

  const add = (v: number) =>
    setAmount((a) => {
      const next = Math.round((a + v) * 10) / 10;
      return available == null ? next : Math.min(next, Math.floor(cap * 10) / 10);
    });

  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-panel-2 p-1 text-sm font-semibold" role="tablist" aria-label="Buy or sell">
        {(["buy", "sell"] as const).map((sd) => (
          <button
            key={sd}
            role="tab"
            aria-selected={side === sd}
            onClick={() => {
              setSide(sd);
              setAmount(0);
              setMsg(null);
            }}
            className={`rounded-lg py-1.5 capitalize ${side === sd ? "bg-panel text-ink shadow-sm" : "text-muted hover:text-ink"}`}
          >
            {sd}
          </button>
        ))}
      </div>
      <p className="line-clamp-2 text-sm text-muted">{question}</p>
      <p className="mt-0.5 font-semibold">
        {selling ? "Selling" : "Betting on"} <span className="text-accent">{chosen.label}</span>
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
          <div className="font-medium">{selling ? "Shares" : "Amount"}</div>
          <div className="text-xs text-muted">
            {available == null
              ? "Sign in to bet"
              : selling
                ? `You hold ${held.toFixed(1)} shares`
                : `Available: ${remaining.toFixed(1)} Clout`}
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
            aria-label={selling ? "Shares to sell" : "Clout to stake"}
          />
          <span className="text-sm text-muted">{selling ? "shares" : "Clout"}</span>
        </label>
      </div>
      <div className="mt-3 flex justify-end gap-1.5">
        {[1, 5, 10].map((v) => (
          <button key={v} onClick={() => add(v)} className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold hover:border-accent">
            +{v}
          </button>
        ))}
        <button
          onClick={() => setAmount(selling ? held : Math.floor(remaining * 10) / 10)}
          className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold hover:border-accent"
        >
          Max
        </button>
      </div>

      {preview && (
        <dl className="tabular mt-4 space-y-1 rounded-xl bg-panel-2 p-3 text-sm">
          {selling ? (
            <div className="flex justify-between"><dt className="text-muted">You receive</dt><dd className="font-semibold text-yes">{preview.clout.toFixed(1)} Clout</dd></div>
          ) : (
            <>
              <div className="flex justify-between"><dt className="text-muted">Shares</dt><dd>{preview.shares.toFixed(1)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Pays if right</dt><dd className="font-semibold text-yes">{preview.shares.toFixed(1)} Clout</dd></div>
            </>
          )}
          <div className="flex justify-between"><dt className="text-muted">Avg price</dt><dd>{Math.round((preview.clout / preview.shares) * 100)}¢ per share</dd></div>
          <div className="flex justify-between"><dt className="text-muted">New price</dt><dd>{Math.round(chosen.price * 100)}% → {Math.round(preview.postPrice * 100)}%</dd></div>
        </dl>
      )}

      {available == null ? (
        <a href="/login" className="mt-4 block w-full rounded-xl bg-accent py-3 text-center font-semibold text-accent-ink">
          Sign in to bet
        </a>
      ) : (
        <button
          disabled={busy || !(amount > 0) || (selling && held <= 0)}
          onClick={submit}
          className="mt-4 w-full rounded-xl bg-accent py-3 font-semibold text-accent-ink transition hover:brightness-110 disabled:opacity-40"
        >
          {busy
            ? "Placing…"
            : selling
              ? held <= 0
                ? `No ${chosen.label} shares to sell`
                : amount > 0
                  ? `Sell ${Math.min(amount, held).toFixed(1)} shares`
                  : "Enter shares"
              : amount > 0
                ? `Bet ${amount} Clout`
                : "Enter an amount"}
        </button>
      )}
      {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-yes" : "text-no"}`}>{msg.text}</p>}
      <p className="mt-3 text-center text-xs text-muted">Betting spends Clout now; each winning share pays 1 Clout at resolution. Sell any time before then at the market price. No real money.</p>
    </div>
  );
}
