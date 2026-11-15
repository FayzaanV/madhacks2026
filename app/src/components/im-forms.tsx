"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? "Something went wrong.");
  return j;
}

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return { busy, msg, run };
}

const Msg = ({ m }: { m: { ok: boolean; text: string } | null }) =>
  m ? <p className={`text-sm ${m.ok ? "text-yes" : "text-no"}`}>{m.text}</p> : null;
const input = "w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent";
const btn = "rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-ink disabled:opacity-50";

// ------------------------------------------------------------------ captain actions (game page)
export function CaptainPanel({ gameId, mode, reported }: { gameId: string; mode: "report" | "respond" | "wait"; reported?: string }) {
  const { busy, msg, run } = useAction();
  const [home, setHome] = useState("");
  const [away, setAway] = useState("");
  const [note, setNote] = useState("");
  if (mode === "wait")
    return <p className="text-sm text-muted">You reported {reported}. Waiting for the other captain (auto-confirms after 2 hours).</p>;
  if (mode === "respond")
    return (
      <div className="space-y-2">
        <p className="text-sm">The other captain reported <b>{reported}</b>. Is that right?</p>
        <div className="flex flex-wrap gap-2">
          <button disabled={busy} className={btn} onClick={() => run(async () => (await post(`/api/intramurals/games/${gameId}/confirm`, {}), "Confirmed. The market is resolved."))}>
            Confirm
          </button>
          <input className={`${input} max-w-xs flex-1`} placeholder="What's wrong? (for the admin)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button disabled={busy} className="rounded-lg border border-no px-3 py-2 text-sm font-semibold text-no" onClick={() => run(async () => (await post(`/api/intramurals/games/${gameId}/dispute`, { note }), "Disputed. An admin will decide."))}>
            Dispute
          </button>
        </div>
        <Msg m={msg} />
      </div>
    );
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => (await post(`/api/intramurals/games/${gameId}/report`, { home: Number(home), away: Number(away) }), "Reported. The other captain needs to confirm."));
      }}
    >
      <label className="text-xs text-muted">Away<input className={`${input} w-20`} inputMode="numeric" value={away} onChange={(e) => setAway(e.target.value)} required /></label>
      <label className="text-xs text-muted">Home<input className={`${input} w-20`} inputMode="numeric" value={home} onChange={(e) => setHome(e.target.value)} required /></label>
      <button disabled={busy} className={btn}>Report final score</button>
      <Msg m={msg} />
    </form>
  );
}

// ------------------------------------------------------------------ admin tools (intramurals page)
export function NewLeagueForm() {
  const { busy, msg, run } = useAction();
  const [f, setF] = useState({ sport: "", season: "", division: "" });
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void run(async () => (await post("/api/intramurals/leagues", f), "League created.")); }}>
      <div className="grid gap-2 sm:grid-cols-3">
        <input className={input} placeholder="Sport (Basketball)" value={f.sport} onChange={(e) => setF({ ...f, sport: e.target.value })} required />
        <input className={input} placeholder="Season (Fall 2026)" value={f.season} onChange={(e) => setF({ ...f, season: e.target.value })} required />
        <input className={input} placeholder="Division (optional)" value={f.division} onChange={(e) => setF({ ...f, division: e.target.value })} />
      </div>
      <button disabled={busy} className={btn}>Create league</button>
      <Msg m={msg} />
    </form>
  );
}

export function ImportForm({ leagueId }: { leagueId: string }) {
  const { busy, msg, run } = useAction();
  const [csv, setCsv] = useState("");
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void run(async () => { const r = await post(`/api/intramurals/leagues/${leagueId}/import`, { csv }); setCsv(""); return `Imported ${r.created} games${r.errors?.length ? ` (${r.errors.length} lines skipped: ${r.errors[0]})` : ""}.`; }); }}>
      <textarea className={`${input} h-28 font-mono`} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={"date,time,home,away,location\n2026-11-18,19:30,Ballers,Dunkers,Nat Gym Court 2"} required />
      <p className="text-xs text-muted">Copy the schedule from FusionPlay. Times are Central, 24-hour. Teams are created automatically, and each game gets a winner market.</p>
      <button disabled={busy} className={btn}>Import games</button>
      <Msg m={msg} />
    </form>
  );
}

export function CaptainForm({ teams }: { teams: { team_id: string; name: string; captain_handle: string | null }[] }) {
  const { busy, msg, run } = useAction();
  const [team, setTeam] = useState(teams[0]?.team_id ?? "");
  const [email, setEmail] = useState("");
  if (!teams.length) return <p className="text-sm text-muted">Import games first; teams are created from the schedule.</p>;
  return (
    <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void run(async () => `Captain set: @${(await post(`/api/intramurals/teams/${team}/captain`, { email })).captain}`); }}>
      <select className={`${input} max-w-xs`} value={team} onChange={(e) => setTeam(e.target.value)}>
        {teams.map((t) => <option key={t.team_id} value={t.team_id}>{t.name}{t.captain_handle ? ` (@${t.captain_handle})` : " (no captain)"}</option>)}
      </select>
      <input className={`${input} max-w-xs flex-1`} type="email" placeholder="captain's Yomi sign-in email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <button disabled={busy} className={btn}>Set captain</button>
      <Msg m={msg} />
    </form>
  );
}

export function AdminResultForm({ gameId }: { gameId: string }) {
  const { busy, msg, run } = useAction();
  const [home, setHome] = useState("");
  const [away, setAway] = useState("");
  const send = (body: unknown, done: string) => run(async () => (await post(`/api/intramurals/games/${gameId}/result`, body), done));
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-xs text-muted">Away<input className={`${input} w-16`} value={away} onChange={(e) => setAway(e.target.value)} /></label>
      <label className="text-xs text-muted">Home<input className={`${input} w-16`} value={home} onChange={(e) => setHome(e.target.value)} /></label>
      <button disabled={busy} className={btn} onClick={() => send({ home: Number(home), away: Number(away) }, "Final score set; market resolved.")}>Set final</button>
      <button disabled={busy} className="rounded-lg border border-line px-2 py-2 text-xs" onClick={() => send({ forfeit: "home" }, "Away team forfeited.")}>Away forfeit</button>
      <button disabled={busy} className="rounded-lg border border-line px-2 py-2 text-xs" onClick={() => send({ forfeit: "away" }, "Home team forfeited.")}>Home forfeit</button>
      <button disabled={busy} className="rounded-lg border border-line px-2 py-2 text-xs" onClick={() => send({ canceled: true }, "Canceled; market voided.")}>Cancel game</button>
      <Msg m={msg} />
    </div>
  );
}
