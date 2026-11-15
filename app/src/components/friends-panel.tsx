"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar } from "./avatar";

type Person = { user_id: string; handle: string; avatar_v: number | null; title: string | null };
type Challenge = {
  challenge_id: string;
  market_id: string;
  question: string;
  challenger_id: string;
  challenger_handle: string;
  opponent_id: string;
  opponent_handle: string;
  challenger_label: string;
  opponent_label: string;
  stake: number;
  status: string;
  winner_id: string | null;
};

const btn = "rounded-lg px-2.5 py-1 text-xs font-semibold";

function PersonRow({ p, children }: { p: Person; children?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <Link href={`/u/${encodeURIComponent(p.user_id)}`} className="flex min-w-0 items-center gap-2 hover:text-accent">
        <Avatar userId={p.user_id} handle={p.handle} v={p.avatar_v} size={28} />
        <span className="truncate font-semibold">@{p.handle}</span>
        {p.title && <span className="truncate text-xs text-muted">{p.title}</span>}
      </Link>
      <span className="ml-auto flex shrink-0 gap-1.5">{children}</span>
    </li>
  );
}

/** Friends: search and add, accept/decline requests, your friends, and head-to-head challenges. */
export function FriendsPanel({
  me,
  friends,
  incoming,
  outgoing,
  challenges,
}: {
  me: string;
  friends: Person[];
  incoming: Person[];
  outgoing: Person[];
  challenges: Challenge[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<(Person & { relation: string })[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function call(url: string, method: string, body?: object) {
    setMsg(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) setMsg({ ok: false, text: j.error ?? "Something went wrong." });
    router.refresh();
    return res.ok ? j : null;
  }

  async function search(v: string) {
    setQuery(v);
    if (v.trim().length < 2) return setResults([]);
    const r = await fetch(`/api/users/search?q=${encodeURIComponent(v)}`).then((x) => x.json()).catch(() => ({ users: [] }));
    setResults(r.users ?? []);
  }

  const pending = challenges.filter((c) => c.status === "pending");
  const active = challenges.filter((c) => c.status === "accepted");
  const done = challenges.filter((c) => ["settled", "void", "declined", "cancelled"].includes(c.status)).slice(0, 10);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-2xl border border-line bg-panel p-4">
        <h2 className="font-semibold">Add friends</h2>
        <input
          value={query}
          onChange={(e) => search(e.target.value)}
          placeholder="Search by @username"
          className="mt-2 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm"
        />
        <ul className="divide-y divide-line">
          {results.map((p) => (
            <PersonRow key={p.user_id} p={p}>
              {p.relation === "friend" ? (
                <span className="text-xs text-muted">Friends</span>
              ) : p.relation === "sent" ? (
                <span className="text-xs text-muted">Requested</span>
              ) : (
                <button
                  className={`${btn} bg-accent text-accent-ink`}
                  onClick={async () => {
                    const r = await call("/api/friends", "POST", { handle: p.handle });
                    if (r) {
                      setMsg({ ok: true, text: r.status === "accepted" ? `You're now friends with @${p.handle}.` : `Request sent to @${p.handle}.` });
                      search(query);
                    }
                  }}
                >
                  {p.relation === "received" ? "Accept" : "Add"}
                </button>
              )}
            </PersonRow>
          ))}
        </ul>
        {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-yes" : "text-no"}`}>{msg.text}</p>}

        {incoming.length > 0 && (
          <>
            <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">Requests</h3>
            <ul className="divide-y divide-line">
              {incoming.map((p) => (
                <PersonRow key={p.user_id} p={p}>
                  <button className={`${btn} bg-accent text-accent-ink`} onClick={() => call(`/api/friends/${p.user_id}`, "PATCH", { accept: true })}>
                    Accept
                  </button>
                  <button className={`${btn} border border-line`} onClick={() => call(`/api/friends/${p.user_id}`, "DELETE")}>
                    Decline
                  </button>
                </PersonRow>
              ))}
            </ul>
          </>
        )}
        {outgoing.length > 0 && (
          <>
            <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">Sent</h3>
            <ul className="divide-y divide-line">
              {outgoing.map((p) => (
                <PersonRow key={p.user_id} p={p}>
                  <button className={`${btn} border border-line`} onClick={() => call(`/api/friends/${p.user_id}`, "DELETE")}>
                    Cancel
                  </button>
                </PersonRow>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-panel p-4">
        <h2 className="font-semibold">
          Your friends <span className="text-sm font-normal text-muted">{friends.length}</span>
        </h2>
        {friends.length ? (
          <ul className="divide-y divide-line">
            {friends.map((p) => (
              <PersonRow key={p.user_id} p={p}>
                <button
                  className={`${btn} border border-line text-muted hover:text-no`}
                  onClick={() => confirm(`Unfriend @${p.handle}?`) && call(`/api/friends/${p.user_id}`, "DELETE")}
                >
                  Unfriend
                </button>
              </PersonRow>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">No friends yet. Search for someone&apos;s username to add them.</p>
        )}
        <p className="mt-3 text-xs text-muted">Challenge a friend from any open market&apos;s page: you each stake Clout and whoever&apos;s right takes both.</p>
      </section>

      <section className="rounded-2xl border border-line bg-panel p-4 lg:col-span-2">
        <h2 className="font-semibold">Challenges</h2>
        {challenges.length === 0 && <p className="mt-2 text-sm text-muted">No challenges yet.</p>}
        <ul className="divide-y divide-line text-sm">
          {[...pending, ...active, ...done].map((c) => {
            const mine = c.challenger_id === me;
            const them = mine ? c.opponent_handle : c.challenger_handle;
            const myPick = mine ? c.challenger_label : c.opponent_label;
            const theirPick = mine ? c.opponent_label : c.challenger_label;
            return (
              <li key={c.challenge_id} className="flex flex-wrap items-center gap-2 py-2.5">
                <span className="min-w-0 flex-1">
                  <Link href={`/markets/${c.market_id}`} className="font-medium hover:text-accent">{c.question}</Link>
                  <span className="block text-xs text-muted">
                    You ({myPick}) vs @{them} ({theirPick}) · {c.stake} Clout each
                  </span>
                </span>
                {c.status === "pending" && !mine && (
                  <>
                    <button className={`${btn} bg-accent text-accent-ink`} onClick={() => call(`/api/challenges/${c.challenge_id}`, "POST", { action: "accept" })}>
                      Accept
                    </button>
                    <button className={`${btn} border border-line`} onClick={() => call(`/api/challenges/${c.challenge_id}`, "POST", { action: "decline" })}>
                      Decline
                    </button>
                  </>
                )}
                {c.status === "pending" && mine && (
                  <>
                    <span className="text-xs text-muted">Waiting for @{them}</span>
                    <button className={`${btn} border border-line`} onClick={() => call(`/api/challenges/${c.challenge_id}`, "POST", { action: "cancel" })}>
                      Cancel
                    </button>
                  </>
                )}
                {c.status === "accepted" && <span className="text-xs font-semibold text-accent">Live · {2 * c.stake} Clout pot</span>}
                {c.status === "settled" && (
                  <span className={`text-xs font-semibold ${c.winner_id === me ? "text-yes" : c.winner_id ? "text-no" : "text-muted"}`}>
                    {c.winner_id === me ? `Won ${2 * c.stake}` : c.winner_id ? "Lost" : "Refunded"}
                  </span>
                )}
                {["void", "declined", "cancelled"].includes(c.status) && <span className="text-xs capitalize text-muted">{c.status}</span>}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
