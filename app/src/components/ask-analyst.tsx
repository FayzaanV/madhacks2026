"use client";

import { useState } from "react";

type Insight = {
  summary: string;
  why_price_moved: string;
  crowd_vs_smart_money: string;
  comment_sentiment: string;
  mispricing_flag: boolean;
  confidence: string;
  generated_at: string;
  model: string;
} | null;

const SUGGESTIONS = ["Why is the price where it is?", "What are people saying in the comments?", "Does Smart Money disagree with the crowd?"];

export function AskAnalyst({ marketId, insight }: { marketId: string; insight: Insight }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(q: string) {
    if (!q.trim() || busy) return;
    setQuestion(q);
    setAnswer("");
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/markets/${marketId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      if (!res.ok || !res.body) {
        setError((await res.json().catch(() => ({}))).error ?? "The AI analyst is unavailable.");
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        setAnswer((a) => a + dec.decode(value, { stream: true }));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-accent/50 bg-panel p-4">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">AI market analyst</h2>
        {insight?.mispricing_flag && (
          <span className="rounded bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-smart">Possible mispricing</span>
        )}
      </div>
      {insight ? (
        <dl className="mt-2 space-y-1.5 text-sm">
          <div><dt className="inline font-medium">Summary: </dt><dd className="inline">{insight.summary}</dd></div>
          <div><dt className="inline font-medium">Why it moved: </dt><dd className="inline">{insight.why_price_moved}</dd></div>
          <div><dt className="inline font-medium">Crowd vs Smart Money: </dt><dd className="inline">{insight.crowd_vs_smart_money}</dd></div>
          <div><dt className="inline font-medium">Comments: </dt><dd className="inline">{insight.comment_sentiment}</dd></div>
          <p className="text-xs text-muted">
            Batch insight from <code>ai_query</code> · {insight.model} · confidence {insight.confidence}
          </p>
        </dl>
      ) : (
        <p className="mt-2 text-sm text-muted">No batch insight yet. It appears after the next refresh job.</p>
      )}

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about this market…"
          maxLength={500}
          className="flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm"
        />
        <button disabled={busy} className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-ink disabled:opacity-50">
          {busy ? "Thinking…" : "Ask"}
        </button>
      </form>
      <div className="mt-2 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => void ask(s)} className="rounded-full border border-line px-2.5 py-1 text-xs text-muted hover:text-ink">
            {s}
          </button>
        ))}
      </div>
      {(answer || error) && (
        <p className={`mt-3 whitespace-pre-wrap text-sm ${error ? "text-no" : ""}`}>{error ?? answer}</p>
      )}
      <p className="mt-2 text-xs text-muted">The analyst explains the market. It never tells you what to bet.</p>
    </section>
  );
}
