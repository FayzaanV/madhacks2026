"use client";

import { useRouter } from "next/navigation";
import { fromMadison } from "@/core/time";
import { useState } from "react";
import { latestClose, suggestQuestion, type AutoRule } from "@/core/auto-rules";
import { AutoRuleFields } from "./auto-rule-fields";

const field = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm";

/**
 * Admin form: create a live market (binary or multiple choice), resolved by hand or automatically from data
 * (weather from Open-Meteo, rec-center crowding from UW Rec Well live counts). Posts to /api/markets.
 */
export function MarketForm() {
  const router = useRouter();
  const [type, setType] = useState<"binary" | "multiple_choice">("binary");
  const [outcomes, setOutcomes] = useState(["", ""]);
  const [mode, setMode] = useState<"manual" | "weather" | "facility">("manual");
  const [rule, setRule] = useState<AutoRule | null>(null);
  const [question, setQuestion] = useState("");
  const auto = mode !== "manual";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (auto && !rule) return setError("Finish the auto-resolution rule first.");
    const closesRaw = String(f.get("closes_at") ?? "");
    // Madison time, whatever the browser's zone. Auto markets left blank close right when the answer starts to be known.
    const closesAt = closesRaw ? fromMadison(closesRaw) : auto && rule ? new Date(latestClose(rule)) : null;
    if (!closesAt) return setError("Pick when trading closes.");
    setBusy(true);
    setError(null);
    const res = await fetch("/api/markets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        course: f.get("course"),
        market_type: auto ? "binary" : type,
        outcomes: !auto && type === "multiple_choice" ? outcomes : undefined,
        closes_at: closesAt.toISOString(),
        auto_rule: auto ? rule : undefined,
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
      <fieldset className="space-y-2 text-sm">
        <legend className="font-medium">How it resolves</legend>
        <div className="flex flex-wrap gap-2">
          {([["manual", "By hand"], ["weather", "Weather (auto)"], ["facility", "Rec center crowd (auto)"]] as const).map(([m, label]) => (
            <button
              type="button"
              key={m}
              onClick={() => { setMode(m); setRule(null); }}
              className={`rounded-lg border px-3 py-1.5 ${mode === m ? "border-accent bg-accent-soft font-semibold text-accent" : "border-line"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {auto && <AutoRuleFields key={mode} kind={mode} onChange={setRule} />}
      </fieldset>

      <label className="block space-y-1 text-sm">
        <span className="flex items-center justify-between">
          <span className="font-medium">Question</span>
          {auto && rule && (
            <button type="button" onClick={() => setQuestion(suggestQuestion(rule))} className="text-xs font-semibold text-accent">
              Use suggested question
            </button>
          )}
        </span>
        <input
          name="question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          required
          minLength={10}
          maxLength={200}
          className={field}
          placeholder={auto && rule ? suggestQuestion(rule) : "Will the CS 400 waitlist clear before Friday?"}
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Course or topic</span>
          <input name="course" maxLength={40} disabled={auto} className={field} placeholder={auto ? "campus" : "COMP SCI 400 (blank = campus)"} />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Trading closes (Madison time)</span>
          <input name="closes_at" type="datetime-local" required={!auto} className={field} />
          {auto && <span className="text-xs text-muted">Blank = close right when the answer starts to be known.</span>}
        </label>
      </div>

      {!auto && (
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
      )}

      <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
        {auto ? (
          <p className="self-end text-sm text-muted">Yes / No market under Campus. The resolution source is set automatically.</p>
        ) : (
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Resolution source</span>
            <input name="resolution_source" maxLength={300} className={field} placeholder="https://registrar.wisc.edu or 'Canvas announcement'" />
          </label>
        )}
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
