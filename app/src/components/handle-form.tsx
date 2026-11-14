"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Pick or change your username (PATCH /api/me). */
export function HandleForm({ current, next, cta = "Save username" }: { current: string; next?: string; cta?: string }) {
  const router = useRouter();
  const [handle, setHandle] = useState(current);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const valid = /^[a-z0-9_]{3,20}$/.test(handle);

  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        const res = await fetch("/api/me", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ handle }),
        });
        const j = await res.json();
        setBusy(false);
        if (!res.ok) return setMsg({ ok: false, text: j.error });
        if (next) {
          router.replace(next);
          router.refresh();
        } else {
          setMsg({ ok: true, text: `You're now @${j.handle}.` });
          router.refresh();
        }
      }}
    >
      <label className="flex items-center rounded-xl border border-line bg-panel-2 px-3 focus-within:border-accent">
        <span className="text-muted">@</span>
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/\s/g, "_"))}
          maxLength={20}
          autoComplete="off"
          spellCheck={false}
          aria-label="Username"
          className="w-full bg-transparent px-1 py-3 outline-none"
        />
      </label>
      <p className={`text-xs ${handle && !valid ? "text-no" : "text-muted"}`}>
        3–20 characters: lowercase letters, numbers and underscores. Shown on leaderboards and comments, so avoid using
        your school ID.
      </p>
      <button disabled={busy || !valid} className="w-full rounded-xl bg-accent py-3 font-semibold text-accent-ink disabled:opacity-50">
        {busy ? "Saving…" : cta}
      </button>
      {msg && <p className={`text-sm ${msg.ok ? "text-yes" : "text-no"}`}>{msg.text}</p>}
    </form>
  );
}
