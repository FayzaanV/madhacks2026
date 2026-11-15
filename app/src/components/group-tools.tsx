"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { fromMadison } from "@/core/time";

const field = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm";
const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-50";

async function send(url: string, method: string, body?: object) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json().catch(() => ({}));
  return { ok: res.ok, j };
}

/** /groups: create a group or join one with an invite code. */
export function CreateOrJoin() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <form
        className="space-y-2 rounded-2xl border border-line bg-panel p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await send("/api/groups", "POST", { name });
          if (!r.ok) return setError(r.j.error ?? "Couldn't create the group.");
          router.push(`/groups/${r.j.group_id}`);
        }}
      >
        <h2 className="font-semibold">Create a group</h2>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. 4th floor Sellery, Stat 340 study group" className={field} />
        <button className={`${btn} bg-accent text-accent-ink`}>Create</button>
      </form>
      <form
        className="space-y-2 rounded-2xl border border-line bg-panel p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const c = code.trim().split("/").pop() ?? "";
          const r = await send("/api/groups/join", "POST", { code: c });
          if (!r.ok) return setError(r.j.error ?? "Couldn't join.");
          router.push(`/groups/${r.j.group_id}`);
        }}
      >
        <h2 className="font-semibold">Join with an invite</h2>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste the invite link or code" className={field} />
        <button className={`${btn} border border-line`}>Join</button>
      </form>
      {error && <p className="text-sm text-no md:col-span-2">{error}</p>}
    </div>
  );
}

/** Invite link with copy, and regenerate for owners/admins. */
export function InviteLink({ groupId, code, canManage }: { groupId: string; code: string; canManage: boolean }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? `/join/${code}` : `${window.location.origin}/join/${code}`;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <code className="rounded-lg bg-panel-2 px-2 py-1 text-xs">{url}</code>
      <button
        className={`${btn} border border-line`}
        onClick={async () => {
          await navigator.clipboard?.writeText(url).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : "Copy invite link"}
      </button>
      {canManage && (
        <button
          className={`${btn} text-muted hover:text-ink`}
          onClick={async () => {
            if (!confirm("Make a new invite link? The old one stops working.")) return;
            await send(`/api/groups/${groupId}/invite`, "POST");
            router.refresh();
          }}
        >
          New link
        </button>
      )}
    </div>
  );
}

/** Owner/admin controls for one member, and leave/delete for the group. */
export function MemberActions({ groupId, userId, role, myRole }: { groupId: string; userId: string; role: string; myRole: string }) {
  const router = useRouter();
  if (role === "owner" || myRole === "member") return null;
  return (
    <span className="flex gap-1">
      {myRole === "owner" && (
        <button
          className="text-xs text-muted hover:text-ink"
          onClick={async () => {
            await send(`/api/groups/${groupId}/members/${userId}`, "PATCH", { role: role === "admin" ? "member" : "admin" });
            router.refresh();
          }}
        >
          {role === "admin" ? "Remove admin" : "Make admin"}
        </button>
      )}
      <button
        className="text-xs text-muted hover:text-no"
        onClick={async () => {
          if (!confirm("Remove this member?")) return;
          await send(`/api/groups/${groupId}/members/${userId}`, "DELETE");
          router.refresh();
        }}
      >
        Remove
      </button>
    </span>
  );
}

export function LeaveOrDelete({ groupId, isOwner }: { groupId: string; isOwner: boolean }) {
  const router = useRouter();
  return (
    <button
      className="text-xs text-muted hover:text-no"
      onClick={async () => {
        if (!confirm(isOwner ? "Delete this group? Open markets are voided and refunded." : "Leave this group?")) return;
        const r = await send(isOwner ? `/api/groups/${groupId}` : `/api/groups/${groupId}/leave`, isOwner ? "DELETE" : "POST");
        if (r.ok) router.push("/groups");
        else alert(r.j.error ?? "Couldn't do that.");
      }}
    >
      {isOwner ? "Delete group" : "Leave group"}
    </button>
  );
}

/** New group market: Yes/No or multiple choice, close time (Madison), and who it's about (members only, optional). */
export function GroupMarketForm({ groupId, members }: { groupId: string; members: { user_id: string; handle: string }[] }) {
  const router = useRouter();
  const [type, setType] = useState<"binary" | "multiple_choice">("binary");
  const [outcomes, setOutcomes] = useState(["", ""]);
  const [tagged, setTagged] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-3 rounded-2xl border border-line bg-panel p-4 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setError(null);
        const r = await send("/api/markets", "POST", {
          group_id: groupId,
          question: f.get("question"),
          market_type: type,
          outcomes: type === "multiple_choice" ? outcomes : undefined,
          closes_at: fromMadison(String(f.get("closes_at"))).toISOString(),
          resolution_source: f.get("resolution_source"),
          liquidity_b: 200,
          tagged,
        });
        setBusy(false);
        if (!r.ok) return setError(r.j.error ?? "Couldn't create the market.");
        router.push(`/markets/${r.j.marketId}`);
      }}
    >
      <h2 className="font-semibold">New group market</h2>
      <input name="question" required minLength={10} maxLength={200} placeholder="Will @sam make it to 8am lecture tomorrow?" className={field} />
      <p className="text-xs text-muted">You can @mention people in this group only. They can veto a market about them.</p>
      <div className="flex gap-2">
        {(["binary", "multiple_choice"] as const).map((t) => (
          <button type="button" key={t} onClick={() => setType(t)} className={`rounded-lg border px-3 py-1.5 ${type === t ? "border-accent bg-accent-soft font-semibold text-accent" : "border-line"}`}>
            {t === "binary" ? "Yes / No" : "Multiple choice"}
          </button>
        ))}
      </div>
      {type === "multiple_choice" && (
        <div className="space-y-2">
          {outcomes.map((o, i) => (
            <input key={i} value={o} required maxLength={60} placeholder={`Outcome ${i + 1}`} className={field}
              onChange={(e) => setOutcomes((os) => os.map((x, j) => (j === i ? e.target.value : x)))} />
          ))}
          {outcomes.length < 8 && (
            <button type="button" className="text-sm font-semibold text-accent" onClick={() => setOutcomes((os) => [...os, ""])}>
              + Add outcome
            </button>
          )}
        </div>
      )}
      <label className="block space-y-1">
        <span className="font-medium">Trading closes (Madison time)</span>
        <input name="closes_at" type="datetime-local" required className={field} />
      </label>
      <input name="resolution_source" maxLength={300} placeholder="How we'll know (optional)" className={field} />
      <fieldset>
        <legend className="font-medium">This market is about… (optional)</legend>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {members.map((m) => (
            <button type="button" key={m.user_id}
              onClick={() => setTagged((t) => (t.includes(m.user_id) ? t.filter((x) => x !== m.user_id) : [...t, m.user_id]))}
              className={`rounded-full border px-2.5 py-1 text-xs ${tagged.includes(m.user_id) ? "border-accent bg-accent-soft text-accent" : "border-line text-muted"}`}>
              @{m.handle}
            </button>
          ))}
        </div>
      </fieldset>
      {error && <p className="text-no">{error}</p>}
      <button disabled={busy} className={`${btn} w-full bg-accent py-2 text-accent-ink`}>{busy ? "Creating…" : "Create market"}</button>
      <p className="text-xs text-muted">Group markets use real Clout but don&apos;t count on public leaderboards. You resolve it; members can dispute within 24h.</p>
    </form>
  );
}

/** /join/[code] confirmation. */
export function JoinButton({ code }: { code: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        className={`${btn} bg-accent px-5 py-2 text-accent-ink`}
        onClick={async () => {
          const r = await send("/api/groups/join", "POST", { code });
          if (!r.ok) return setError(r.j.error ?? "Couldn't join.");
          router.push(`/groups/${r.j.group_id}`);
        }}
      >
        Join group
      </button>
      {error && <p className="mt-2 text-sm text-no">{error}</p>}
    </div>
  );
}

/** Group page: invite friends who aren't members yet, right from the app. */
export function InviteFriends({
  groupId,
  friends,
}: {
  groupId: string;
  friends: { user_id: string; handle: string; invited: boolean }[];
}) {
  const router = useRouter();
  const [sent, setSent] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="rounded-2xl border border-line bg-panel p-4 text-sm">
      <h2 className="font-semibold">Invite friends</h2>
      {friends.length === 0 ? (
        <p className="mt-1 text-muted">
          All your friends are in already, or you haven&apos;t added any yet. Add friends on the <a href="/friends" className="text-accent">Friends</a> page.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {friends.map((f) => {
            const done = f.invited || sent.includes(f.user_id);
            return (
              <li key={f.user_id} className="flex items-center gap-2">
                <span className="font-medium">@{f.handle}</span>
                <button
                  disabled={done}
                  className={`ml-auto ${btn} ${done ? "text-muted" : "bg-accent text-accent-ink"}`}
                  onClick={async () => {
                    setError(null);
                    const r = await send(`/api/groups/${groupId}/invites`, "POST", { user_ids: [f.user_id] });
                    if (!r.ok) return setError(r.j.error ?? "Couldn't invite.");
                    setSent((s) => [...s, f.user_id]);
                    router.refresh();
                  }}
                >
                  {done ? "Invited" : "Invite"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="mt-1 text-no">{error}</p>}
    </section>
  );
}

/** /groups: invites waiting for you; join or decline in one click. */
export function InviteList({ invites }: { invites: { group_id: string; name: string; invited_by: string; members: number }[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  if (!invites.length) return null;
  return (
    <section className="rounded-2xl border border-accent bg-accent-soft/40 p-4 text-sm">
      <h2 className="font-semibold">Invitations</h2>
      <ul className="mt-2 divide-y divide-line">
        {invites.map((i) => (
          <li key={i.group_id} className="flex flex-wrap items-center gap-2 py-2">
            <span className="flex-1">
              <b>{i.name}</b> <span className="text-muted">· {i.members} member{i.members === 1 ? "" : "s"} · from @{i.invited_by}</span>
            </span>
            <button
              className={`${btn} bg-accent text-accent-ink`}
              onClick={async () => {
                const r = await send(`/api/groups/invites/${i.group_id}`, "POST", { accept: true });
                if (!r.ok) return setError(r.j.error ?? "Couldn't join.");
                router.push(`/groups/${i.group_id}`);
              }}
            >
              Join
            </button>
            <button
              className={`${btn} border border-line`}
              onClick={async () => {
                await send(`/api/groups/invites/${i.group_id}`, "POST", { accept: false });
                router.refresh();
              }}
            >
              Decline
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-1 text-no">{error}</p>}
    </section>
  );
}
