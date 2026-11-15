"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type P = { partner_id: string; name: string; venue_ids: string[]; created_at: string; last_used_at: string | null; revoked_at: string | null };

/** Admin: issue and revoke partner API keys. A new key is shown once (only its hash is stored). */
export function PartnerKeys({ partners, venues, canManage }: { partners: P[]; venues: { venue_id: string; name: string }[]; canManage: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("Wisconsin Union");
  const [picked, setPicked] = useState<string[]>(venues.map((v) => v.venue_id));
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3 text-sm">
      {partners.length ? (
        <ul className="divide-y divide-line">
          {partners.map((p) => (
            <li key={p.partner_id} className="flex flex-wrap items-center gap-2 py-2">
              <b>{p.name}</b>
              <span className="text-xs text-muted">{p.venue_ids.join(", ")}</span>
              <span className="ml-auto text-xs text-muted">
                {p.revoked_at ? "revoked" : p.last_used_at ? `last used ${new Date(p.last_used_at).toLocaleString()}` : "never used"}
              </span>
              {canManage && !p.revoked_at && (
                <button
                  onClick={async () => {
                    if (!confirm(`Revoke ${p.name}'s key? Their integrations stop immediately.`)) return;
                    await fetch(`/api/partners/${p.partner_id}`, { method: "DELETE" });
                    router.refresh();
                  }}
                  className="text-xs text-no"
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">No partner keys yet.</p>
      )}
      {canManage && (
        <form
          className="space-y-2 rounded-xl bg-panel-2 p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            const res = await fetch("/api/partners", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name, venue_ids: picked }),
            });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) return setError(j.error ?? "Couldn't create the key.");
            setKey(j.api_key);
            router.refresh();
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} className="rounded-lg border border-line bg-bg px-2 py-1" aria-label="Partner name" />
            {venues.map((v) => (
              <label key={v.venue_id} className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={picked.includes(v.venue_id)}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, v.venue_id] : p.filter((x) => x !== v.venue_id)))}
                  className="accent-[var(--accent)]"
                />
                {v.name}
              </label>
            ))}
            <button className="ml-auto rounded-lg bg-accent px-3 py-1 font-semibold text-accent-ink">Create key</button>
          </div>
          {error && <p className="text-no">{error}</p>}
          {key && (
            <p className="break-all rounded-lg border border-accent bg-bg p-2 font-mono text-xs">
              {key}
              <span className="mt-1 block font-sans text-muted">Copy it now. It won&apos;t be shown again.</span>
            </p>
          )}
        </form>
      )}
    </div>
  );
}
