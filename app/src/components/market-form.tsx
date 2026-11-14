"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const field = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm";

/** Admin form: create a live market (binary or multiple choice). Posts to /api/markets, then opens the market. */
export function MarketForm() {
  const router = useRouter();
  const [type, setType] = useState<"binary" | "multiple_choice">("binary");
  const [outcomes, setOutcomes] = useState(["", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const res = await fetch("/api/markets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: f.get("question"),
        course: f.get("course"),
        market_type: type,
        outcomes: type === "multiple_choice" ? outcomes : undefined,
        closes_at: new Date(String(f.get("closes_at"))).toISOString(),
        resolution_source: f.get("resolution_source"),
        liquidity_b: Number(f.get("liquidity_b")),
        not_about_a_student: f.get("not_about_a_student") === "on",
      }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(j.error ?? "Couldn't create the market.");
    router.push(`/markets/${j.marketId}`);
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-panel p-5">
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Question</span>
        <input name="question" required minLength={10} maxLength={200} className={field} placeholder="Will the CS 400 waitlist clear before Friday?" />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Course or topic</span>
          <input name="course" maxLength={40} className={field} placeholder="COMP SCI 400 (blank = campus)" />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Trading closes</span>
          <input name="closes_at" type="datetime-local" required className={field} />
        </label>
      </div>

      <fieldset className="space-y-2 text-sm">
        <legend className="font-medium">Type</legend>
        <div className="flex gap-2">
          {(["binary", "multiple_choice"] as const).map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => setType(t)}
              className={`rounded-lg border px-3 py-1.5 ${type === t ? "border-accent bg-accent-soft font-semibold text-accent" : "border-line"}`}
            >
              {t === "binary" ? "Yes / No" : "Multiple choice"}
            </button>
          ))}
        </div>
        {type === "multiple_choice" && (
          <div className="space-y-2">
            {outcomes.map((o, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={o}
                  onChange={(e) => setOutcomes((os) => os.map((x, j) => (j === i ? e.target.value : x)))}
                  maxLength={60}
                  required
                  placeholder={`Outcome ${i + 1}`}
                  className={field}
                />
                {outcomes.length > 2 && (
                  <button type="button" onClick={() => setOutcomes((os) => os.filter((_, j) => j !== i))} className="px-2 text-muted hover:text-no" aria-label="Remove outcome">
                    ×
                  </button>
                )}
              </div>
            ))}
            {outcomes.length < 8 && (
              <button type="button" onClick={() => setOutcomes((os) => [...os, ""])} className="text-sm font-semibold text-accent">
                + Add outcome
              </button>
            )}
          </div>
        )}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Resolution source</span>
          <input name="resolution_source" maxLength={300} className={field} placeholder="https://registrar.wisc.edu or 'Canvas announcement'" />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Liquidity b</span>
          <input name="liquidity_b" type="number" min={50} max={5000} step={50} defaultValue={500} className={field} />
        </label>
      </div>
      <p className="text-xs text-muted">Higher b = prices move less per bet. 500 means a 10 Clout bet moves a 50/50 market about 1 point.</p>

      <label className="flex items-start gap-2 text-sm">
        <input name="not_about_a_student" type="checkbox" required className="mt-0.5 accent-[var(--accent)]" />
        <span>This market isn&apos;t about an individual student.</span>
      </label>

      {error && <p className="text-sm text-no">{error}</p>}
      <button disabled={busy} className="w-full rounded-xl bg-accent py-3 font-semibold text-accent-ink disabled:opacity-50">
        {busy ? "Creating…" : "Create market"}
      </button>
    </form>
  );
}
