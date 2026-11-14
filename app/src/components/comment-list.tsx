"use client";

import Link from "next/link";
import { useState } from "react";
import type { Comment, CommentPage } from "@/server/markets";
import { Avatar, PersonLine } from "./avatar";
import { Clout } from "./clout";

type Me = { user_id: string; handle: string; title: string | null; avatar_v: number | null; clout: number } | null;

/**
 * Market comments: scrollable, newest first, 50 at a time with "Load older comments" (nothing silently drops off).
 * New comments appear at the top immediately and keep whatever older pages are already loaded.
 */
export function CommentList({ marketId, initial, me }: { marketId: string; initial: CommentPage; me: Me }) {
  const [comments, setComments] = useState<Comment[]>(initial.comments);
  const [next, setNext] = useState(initial.next);
  const [total, setTotal] = useState(initial.total);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (!me) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/markets/${marketId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(j.error ?? "Couldn't post.");
    setComments((cs) => [
      { comment_id: j.commentId, created_at: j.created_at, body: body.trim(), is_simulated: false, ...me },
      ...cs,
    ]);
    setTotal((n) => n + 1);
    setBody("");
  }

  async function loadOlder() {
    if (!next) return;
    setBusy(true);
    const res = await fetch(`/api/markets/${marketId}/comments?before=${encodeURIComponent(next)}`);
    const j = (await res.json().catch(() => null)) as CommentPage | null;
    setBusy(false);
    if (!res.ok || !j) return setError("Couldn't load older comments.");
    setComments((cs) => [...cs, ...j.comments.filter((c) => !cs.some((x) => x.comment_id === c.comment_id))]);
    setNext(j.next);
  }

  async function remove(id: string) {
    const res = await fetch(`/api/comments/${id}`, { method: "DELETE" });
    if (!res.ok) return setError("Couldn't delete that comment.");
    setComments((cs) => cs.filter((c) => c.comment_id !== id));
    setTotal((n) => n - 1);
  }

  return (
    <section className="rounded-2xl border border-line bg-panel p-4">
      <h2 className="font-semibold">
        Comments <span className="text-sm font-normal text-muted">{total}</span>
      </h2>
      {me ? (
        <form className="mt-2 flex gap-2" onSubmit={post}>
          <input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={500}
            placeholder="Add a comment (no posts about individual students)"
            className="flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm"
          />
          <button disabled={busy || !body.trim()} className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-ink disabled:opacity-50">
            Post
          </button>
        </form>
      ) : (
        <p className="mt-2 text-sm text-muted">
          <Link href="/login" className="text-accent">Sign in</Link> to comment.
        </p>
      )}
      {error && <p className="mt-1 text-sm text-no">{error}</p>}

      <div className="mt-3 max-h-[480px] overflow-y-auto pr-1">
        {comments.length === 0 && <p className="py-4 text-center text-sm text-muted">No comments yet. Start the conversation.</p>}
        <ul className="divide-y divide-line">
          {comments.map((c) => (
            <li key={c.comment_id} className="flex gap-2.5 py-2.5 text-sm">
              <Avatar userId={c.user_id} handle={c.handle} v={c.avatar_v} size={28} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs">
                  <PersonLine handle={c.handle} title={c.title} sim={c.is_simulated} />
                  <Clout value={c.clout} className="text-xs" />
                  <span className="text-muted">{new Date(c.created_at).toLocaleDateString()}</span>
                  {me?.user_id === c.user_id && (
                    <button onClick={() => remove(c.comment_id)} className="ml-auto text-muted hover:text-no" aria-label="Delete comment">
                      Delete
                    </button>
                  )}
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words">{c.body}</p>
              </div>
            </li>
          ))}
        </ul>
        {next && (
          <button onClick={loadOlder} disabled={busy} className="mt-2 w-full rounded-lg border border-line py-2 text-sm font-semibold text-accent disabled:opacity-50">
            {busy ? "Loading…" : "Load older comments"}
          </button>
        )}
      </div>
    </section>
  );
}
