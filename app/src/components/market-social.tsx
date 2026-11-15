"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { fmtDateTime } from "@/core/time";

type Outcome = { index: number; label: string };
const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-50";

async function send(url: string, body?: object) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const j = await res.json().catch(() => ({}));
  return { ok: res.ok, j };
}

/** Shown to a member a group market is about: veto it (voids, everyone refunded). */
export function VetoBox({ marketId }: { marketId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="rounded-2xl border border-no bg-no-soft p-4 text-sm">
      <h2 className="font-semibold">This market is about you</h2>
      <p className="mt-0.5 text-muted">Not okay with it? Veto it: the market is voided and everyone gets their Clout back.</p>
      <button
        className={`${btn} mt-2 bg-no text-white`}
        onClick={async () => {
          if (!confirm("Veto this market? It's voided and everyone is refunded.")) return;
          const r = await send(`/api/markets/${marketId}/veto`);
          if (!r.ok) return setError(r.j.error ?? "Couldn't veto.");
          router.refresh();
        }}
      >
        Veto market
      </button>
      {error && <p className="mt-1 text-no">{error}</p>}
    </section>
  );
}

/** Group market disputes: open one (24h after resolution), or vote if you're eligible. */
export function DisputeBox({
  marketId,
  outcomes,
  state,
  me,
}: {
  marketId: string;
  outcomes: Outcome[];
  state: { open: boolean; canDispute: boolean; reason: string | null; closes_at: string | null; eligible: string[]; counts: Record<string, number>; myVote: string | null };
  me: string;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const label = (k: string) => (k === "void" ? "Void" : (outcomes.find((o) => String(o.index) === k)?.label ?? k));

  if (!state.open && state.canDispute)
    return (
      <form
        className="space-y-2 rounded-2xl border border-line bg-panel p-4 text-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await send(`/api/markets/${marketId}/dispute`, { reason });
          setMsg(r.ok ? { ok: true, text: r.j.note ?? `Dispute opened: ${r.j.eligible} member(s) can vote.` } : { ok: false, text: r.j.error ?? "Couldn't dispute." });
          router.refresh();
        }}
      >
        <h2 className="font-semibold">Think this was resolved wrong?</h2>
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Why (optional)" className="w-full rounded-lg border border-line bg-bg px-3 py-2" />
        <button className={`${btn} border border-line`}>Dispute (24h)</button>
        {msg && <p className={msg.ok ? "text-yes" : "text-no"}>{msg.text}</p>}
      </form>
    );
  if (!state.open) return null;
  const canVote = state.eligible.includes(me);
  return (
    <section className="space-y-2 rounded-2xl border border-accent bg-accent-soft/40 p-4 text-sm">
      <h2 className="font-semibold">Disputed: members are voting</h2>
      {state.reason && <p className="text-muted">&ldquo;{state.reason}&rdquo;</p>}
      <p className="text-xs text-muted">
        {state.eligible.length} eligible voter{state.eligible.length === 1 ? "" : "s"} (members who didn&apos;t trade it) · closes {state.closes_at ? fmtDateTime(state.closes_at) : ""}
      </p>
      <ul className="text-xs">
        {Object.entries(state.counts).map(([k, n]) => (
          <li key={k}>
            {label(k)}: <b>{n}</b>
          </li>
        ))}
      </ul>
      {canVote ? (
        <div className="flex flex-wrap gap-1.5">
          {[...outcomes.map((o) => String(o.index)), "void"].map((k) => (
            <button
              key={k}
              className={`${btn} border ${state.myVote === k ? "border-accent bg-accent text-accent-ink" : "border-line bg-panel"}`}
              onClick={async () => {
                const r = await send(`/api/markets/${marketId}/vote`, { vote: k === "void" ? "void" : Number(k) });
                setMsg(r.ok ? { ok: true, text: r.j.closed ? (r.j.changed ? "Vote decided it: the result changed." : "Vote decided it: the result stands.") : "Vote saved." } : { ok: false, text: r.j.error });
                router.refresh();
              }}
            >
              {label(k)}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted">You can&apos;t vote on this one (you traded it, made it, disputed it, or it&apos;s about you).</p>
      )}
      {msg && <p className={msg.ok ? "text-yes" : "text-no"}>{msg.text}</p>}
    </section>
  );
}

/** Challenge a friend head-to-head on this market: you pick a side and a stake; they accept or decline. */
export function ChallengeBox({ marketId, outcomes, friends, binary }: { marketId: string; outcomes: Outcome[]; friends: { user_id: string; handle: string }[]; binary: boolean }) {
  const [open, setOpen] = useState(false);
  const [friend, setFriend] = useState(friends[0]?.user_id ?? "");
  const [mine, setMine] = useState(outcomes[0]?.index ?? 0);
  const [theirs, setTheirs] = useState<string>("");
  const [stake, setStake] = useState(10);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className={`${btn} w-full border border-line bg-panel py-2`}>
        ⚔ Challenge a friend
      </button>
    );
  if (!friends.length)
    return (
      <p className="rounded-2xl border border-line bg-panel p-4 text-sm text-muted">
        Add friends first (Friends page), then challenge them here.
      </p>
    );
  return (
    <form
      className="space-y-2 rounded-2xl border border-line bg-panel p-4 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await send("/api/challenges", { friend_id: friend, market_id: marketId, outcome: mine, opponent_outcome: theirs === "" ? null : Number(theirs), stake });
        setMsg(r.ok ? { ok: true, text: "Challenge sent! Stakes move when they accept." } : { ok: false, text: r.j.error ?? "Couldn't send." });
      }}
    >
      <h2 className="font-semibold">Challenge a friend</h2>
      <select value={friend} onChange={(e) => setFriend(e.target.value)} className="w-full rounded-lg border border-line bg-bg px-3 py-2">
        {friends.map((f) => (
          <option key={f.user_id} value={f.user_id}>
            @{f.handle}
          </option>
        ))}
      </select>
      <label className="block">
        You say
        <select value={mine} onChange={(e) => setMine(Number(e.target.value))} className="ml-2 rounded-lg border border-line bg-bg px-2 py-1">
          {outcomes.map((o) => (
            <option key={o.index} value={o.index}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {!binary && (
        <label className="block">
          They take
          <select value={theirs} onChange={(e) => setTheirs(e.target.value)} className="ml-2 rounded-lg border border-line bg-bg px-2 py-1">
            <option value="">anything else</option>
            {outcomes.filter((o) => o.index !== mine).map((o) => (
              <option key={o.index} value={o.index}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block">
        Stake (each)
        <input type="number" min={1} step={1} value={stake} onChange={(e) => setStake(Math.max(1, Math.floor(Number(e.target.value) || 1)))} className="ml-2 w-20 rounded-lg border border-line bg-bg px-2 py-1" />
        <span className="ml-1 text-muted">Clout · winner takes {2 * stake}</span>
      </label>
      <button className={`${btn} w-full bg-accent py-2 text-accent-ink`}>Send challenge</button>
      {msg && <p className={msg.ok ? "text-yes" : "text-no"}>{msg.text}</p>}
    </form>
  );
}
