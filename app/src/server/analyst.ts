import "server-only";
import { config, databricksHost, databricksToken } from "./databricks";
import { getComments, getMarket, smartMoney } from "./markets";
import { q } from "./ledger";
import { querySql } from "./warehouse";

export const SYSTEM_PROMPT = `You are Yomi's AI market analyst for a college prediction market (students from many universities; these markets are about UW-Madison).
Students bet reputation points called Clout, never money.
Rules:
- Explain the market: what the odds mean, why the price moved, what the comments say, and whether the crowd
  disagrees with Smart Money (a Clout-weighted price that only counts users with positive Clout).
- Never tell the user what to bet or promise an outcome. You may say where the data points.
- Never discuss, identify, or speculate about individual students.
- Use only the CONTEXT below; if something isn't in it, say you don't know.
- If the context says the data is simulated, mention that once.
- Prices are probabilities: write them as percentages. Keep answers under 150 words, plain text, no markdown headers.`;

export type Insight = {
  summary: string;
  why_price_moved: string;
  crowd_vs_smart_money: string;
  comment_sentiment: string;
  mispricing_flag: boolean;
  confidence: string;
  generated_at: string;
  model: string;
};

/** Batch insight written by the 30_ai_analyst_batch job (ai_query) into gold. */
export async function getInsight(marketId: string): Promise<Insight | null> {
  try {
    const rows = await querySql<Insight>(
      `SELECT summary, why_price_moved, crowd_vs_smart_money, comment_sentiment, mispricing_flag, confidence,
              CAST(generated_at AS STRING) AS generated_at, model
       FROM {catalog}.gold.market_ai_insights WHERE market_id = :id`,
      { id: marketId },
    );
    return rows[0] ?? null;
  } catch {
    return null; // table not built yet
  }
}

async function buildContext(marketId: string) {
  const [market, comments, sm, insight, recent] = await Promise.all([
    getMarket(marketId),
    getComments(marketId),
    smartMoney(marketId).catch(() => []),
    getInsight(marketId),
    q<{ outcome_index: number; n: number; clout: number }>(
      `SELECT outcome_index, count(*)::int AS n, sum(clout_spent)::float AS clout FROM trades
       WHERE market_id = $1 AND created_at > (SELECT max(created_at) FROM trades WHERE market_id = $1) - interval '24 hours'
       GROUP BY outcome_index ORDER BY outcome_index`,
      [marketId],
    ),
  ]);
  if (!market) return null;
  return {
    market,
    text: JSON.stringify(
      {
        question: market.question,
        course: market.course,
        closes_at: market.closes_at,
        resolution_source: market.resolution_source,
        data_is_simulated: market.is_simulated,
        live_crowd_prices: market.outcomes.map((o) => ({ outcome: o.label, crowd: +o.price.toFixed(3) })),
        smart_money_from_gold: sm.map((s) => ({ outcome: s.label, smart_money: s.smart_price && +s.smart_price.toFixed(3) })),
        total_trades: market.n_trades,
        total_clout_volume: Math.round(market.volume),
        last_24h_by_outcome: recent.map((r) => ({ outcome: market.outcomes[r.outcome_index]?.label, trades: r.n, clout: Math.round(r.clout) })),
        recent_comments: comments.slice(0, 12).map((c) => c.body),
        batch_insight: insight && {
          summary: insight.summary,
          why_price_moved: insight.why_price_moved,
          crowd_vs_smart_money: insight.crowd_vs_smart_money,
          mispricing_flag: insight.mispricing_flag,
        },
      },
      null,
      1,
    ),
  };
}

/**
 * Ask the analyst about one market. Streams plain text from the Foundation Model endpoint and logs the
 * Q&A to Lakebase (ai_questions), which the refresh job syncs into bronze for analysis.
 */
export async function askAnalyst(marketId: string, userId: string, question: string): Promise<ReadableStream<Uint8Array>> {
  const ctx = await buildContext(marketId);
  if (!ctx) throw new Error("Market not found");
  const started = Date.now();
  const res = await fetch(`${databricksHost}/serving-endpoints/${config.aiModel}/invocations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await databricksToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: `${SYSTEM_PROMPT}\n\nCONTEXT:\n${ctx.text}` },
        { role: "user", content: question.slice(0, 500) },
      ],
      max_tokens: 400,
      temperature: 0.3,
      stream: true,
    }),
  });
  if (!res.ok || !res.body) throw new Error(`Model endpoint error ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let answer = "";
  let buf = "";
  const reader = res.body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        q(
          `INSERT INTO ai_questions (question_id, market_id, user_id, question, answer, model, latency_ms)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [`aq-${crypto.randomUUID()}`, marketId, userId, question, answer, config.aiModel, Date.now() - started],
        ).catch((e) => console.error("ai_questions log failed", e));
        return;
      }
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const data = line.replace(/^data:\s*/, "").trim();
        if (!data || data === "[DONE]" || !line.startsWith("data:")) continue;
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta?.content ?? "";
          if (delta) {
            answer += delta;
            controller.enqueue(enc.encode(delta));
          }
        } catch {
          /* partial line */
        }
      }
    },
    cancel() {
      void reader.cancel();
    },
  });
}
