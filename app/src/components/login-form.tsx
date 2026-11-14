"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { OTHER_SCHOOL, UNIVERSITIES } from "@/core/universities";

const SORTED = [...UNIVERSITIES].sort((a, b) => a.name.localeCompare(b.name));

export function LoginForm() {
  const [school, setSchool] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ sent: boolean; devLink?: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, school_id: school }),
    });
    const j = await res.json();
    setBusy(false);
    if (!res.ok) return setError(j.error);
    setDone(j);
  }

  if (done)
    return (
      <div className="mt-5 space-y-3">
        {done.sent ? (
          <p className="rounded-xl bg-accent-soft p-3 text-sm">
            Check <b>{email}</b> for your sign-in link. It expires in 15 minutes.
          </p>
        ) : (
          <div className="rounded-xl border border-dashed border-accent p-3 text-sm">
            <p className="font-semibold text-accent">Demo mode: email sending isn&apos;t set up yet.</p>
            <p className="mt-1 text-muted">This is the link we would have emailed you:</p>
            <a href={done.devLink} className="mt-2 block break-all rounded-lg bg-accent px-3 py-2 text-center font-semibold text-accent-ink">
              Open sign-in link
            </a>
          </div>
        )}
        <button onClick={() => setDone(null)} className="text-sm text-muted underline">
          Use a different email
        </button>
      </div>
    );

  return (
    <form onSubmit={submit} className="mt-5 space-y-3">
      <label className="block text-sm">
        <span className="text-muted">Your university</span>
        <select
          required
          value={school}
          onChange={(e) => setSchool(e.target.value)}
          className="mt-1 w-full rounded-xl border border-line bg-panel-2 px-3 py-3 outline-none focus:border-accent"
        >
          <option value="" disabled>
            Select your university…
          </option>
          {SORTED.map((u) => (
            <option key={u.school_id} value={u.school_id}>
              {u.name}
            </option>
          ))}
          <option value={OTHER_SCHOOL}>My school isn&apos;t listed (any .edu email)</option>
        </select>
      </label>
      <input
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={
          school && school !== OTHER_SCHOOL
            ? `you@${UNIVERSITIES.find((u) => u.school_id === school)?.domain}`
            : "you@school.edu"
        }
        className="w-full rounded-xl border border-line bg-panel-2 px-3 py-3 outline-none focus:border-accent"
      />
      <button disabled={busy} className="w-full rounded-xl bg-accent py-3 font-semibold text-accent-ink disabled:opacity-50">
        {busy ? "Sending…" : "Email me a sign-in link"}
      </button>
      {error && <p className="text-sm text-no">{error}</p>}
    </form>
  );
}

export function VerifyButton({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-5">
      <button
        disabled={busy || !token}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await fetch("/api/auth/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          });
          const j = await res.json();
          setBusy(false);
          if (!res.ok) return setError(j.error);
          router.replace(j.needsHandle ? "/welcome" : "/");
          router.refresh();
        }}
        className="w-full rounded-xl bg-accent py-3 font-semibold text-accent-ink disabled:opacity-50"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
      {error && (
        <p className="mt-3 text-sm text-no">
          {error} <a href="/login" className="underline">Get a new link</a>
        </p>
      )}
    </div>
  );
}

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await fetch("/api/auth/session", { method: "DELETE" });
        router.refresh();
      }}
      className="rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-panel-2 hover:text-ink"
    >
      Sign out
    </button>
  );
}
