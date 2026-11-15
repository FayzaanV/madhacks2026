import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { prices } from "@/core/lmsr";
import { AuthError } from "./auth";
import { q, tx } from "./ledger";
import { isAdmin } from "./markets";
import { querySql } from "./warehouse";

/**
 * Union markets: Wisconsin Union venues with live readings (Occuspace sensors, partner point-of-sale data, or the
 * simulated feed), student check-ins, settlement rules, and the enterprise partner API. Markets are created and
 * settled by Databricks jobs (databricks/lib/union.py); the app shows the data and takes partner/student input.
 */

export const METRIC_LABEL: Record<string, string> = {
  people: "people",
  occupancy_pct: "% full",
  wait_min: "min wait",
  line_len: "in line",
  sales: "items sold today",
};
const METRICS = new Set(Object.keys(METRIC_LABEL));
const SOURCE_RANK: Record<string, number> = { partner: 0, occuspace: 1, sim: 2 };
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Postgres "relation does not exist": the Union tables haven't been applied to the ledger yet (db/schema.sql). */
const isMissingTable = (e: unknown) => (e as { code?: string })?.code === "42P01";

/** Run a Union read, returning `fallback` instead of erroring while the Union tables don't exist yet. */
export async function ifConnected<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isMissingTable(e)) return fallback;
    throw e;
  }
}

/** Waitz-style label for an occupancy percentage (same cutoffs as databricks/lib/venues.py busy_level). */
export const busyLevel = (pct: number | null) =>
  pct == null ? "unknown" : pct >= 75 ? "Very busy" : pct >= 45 ? "Busy" : "Not busy";

type Reading = { metric: string; value: number; observed_at: string; source: string; is_simulated: boolean };
export type Venue = {
  venue_id: string;
  name: string;
  building: string;
  capacity: number;
  sensor: string;
  latest: Record<string, Reading>; // best source per metric in the last 30 minutes
  today: { t: number; v: number }[]; // headline metric since local midnight
  headline: string; // occupancy_pct, or wait_min for point-of-sale venues
  reports: { metric: string; median: number; n: number }[]; // student check-ins, last 30 min
  markets: { market_id: string; question: string; yes: number; closes_at: string }[];
};

/** All venues with live data, today's history, student reports and today's open markets. null = Union not connected. */
export function listVenues(): Promise<Venue[] | null> {
  return ifConnected(loadVenues, null);
}

async function loadVenues(): Promise<Venue[]> {
  const [venues, latest, today, reports, markets] = await Promise.all([
    q<{ venue_id: string; name: string; building: string; capacity: number; sensor: string }>(
      "SELECT venue_id, name, building, capacity, sensor FROM venues ORDER BY building, name",
    ),
    q<Reading & { venue_id: string }>(
      `SELECT DISTINCT ON (venue_id, metric) venue_id, metric, value, observed_at, source, is_simulated FROM venue_metrics
       WHERE observed_at > now() - interval '30 minutes'
       ORDER BY venue_id, metric, observed_at DESC, CASE source WHEN 'partner' THEN 0 WHEN 'occuspace' THEN 1 ELSE 2 END`,
    ),
    q<{ venue_id: string; metric: string; t: number; v: number; source: string }>(
      `SELECT venue_id, metric, (extract(epoch FROM observed_at) * 1000)::float8 AS t, value AS v, source FROM venue_metrics
       WHERE metric IN ('occupancy_pct', 'wait_min')
         AND observed_at >= date_trunc('day', now() AT TIME ZONE 'America/Chicago') AT TIME ZONE 'America/Chicago'
       ORDER BY observed_at`,
    ),
    q<{ venue_id: string; metric: string; median: number; n: number }>(
      `SELECT venue_id, metric, percentile_cont(0.5) WITHIN GROUP (ORDER BY value)::float AS median, count(*)::int AS n
       FROM venue_reports WHERE created_at > now() - interval '30 minutes' GROUP BY venue_id, metric`,
    ),
    q<{ venue_id: string; market_id: string; question: string; closes_at: string; liquidity_b: number; q: number[] }>(
      `SELECT r.venue_id, m.market_id, m.question, m.closes_at, m.liquidity_b,
              array_agg(o.q_shares ORDER BY o.outcome_index) AS q
       FROM market_rules r JOIN markets m USING (market_id) JOIN outcomes o USING (market_id)
       WHERE m.status = 'live' AND m.closes_at > now()
       GROUP BY r.venue_id, m.market_id, m.question, m.closes_at, m.liquidity_b ORDER BY m.closes_at`,
    ),
  ]);
  return venues.map((v) => {
    const headline = v.sensor === "occuspace" || latest.some((l) => l.venue_id === v.venue_id && l.metric === "occupancy_pct") ? "occupancy_pct" : "wait_min";
    // One point per timestamp, best source wins (partner > occuspace > sim).
    const pts = new Map<number, { v: number; rank: number }>();
    for (const r of today)
      if (r.venue_id === v.venue_id && r.metric === headline) {
        const rank = SOURCE_RANK[r.source] ?? 9;
        const cur = pts.get(r.t);
        if (!cur || rank < cur.rank) pts.set(r.t, { v: r.v, rank });
      }
    return {
      ...v,
      headline,
      latest: Object.fromEntries(latest.filter((l) => l.venue_id === v.venue_id).map((l) => [l.metric, l])),
      today: [...pts].map(([t, p]) => ({ t, v: p.v })).sort((a, b) => a.t - b.t),
      reports: reports.filter((r) => r.venue_id === v.venue_id),
      markets: markets
        .filter((m) => m.venue_id === v.venue_id)
        .map((m) => ({ market_id: m.market_id, question: m.question, closes_at: m.closes_at, yes: prices(m.q, m.liquidity_b)[0] })),
    };
  });
}

/** Student check-in: "the line is N people / the wait is N minutes". One per venue per 15 minutes per user. */
export async function addReport(userId: string, venueId: string, metric: unknown, raw: unknown) {
  if (metric !== "wait_min" && metric !== "line_len") throw new AuthError("Report a wait (minutes) or a line length.");
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > (metric === "wait_min" ? 120 : 200))
    throw new AuthError(metric === "wait_min" ? "Wait must be 0–120 minutes." : "Line must be 0–200 people.");
  return tx(async (c) => {
    if (!(await c.query("SELECT 1 FROM venues WHERE venue_id = $1", [venueId])).rowCount) throw new AuthError("Unknown venue.", 404);
    await c.query("SELECT 1 FROM users WHERE user_id = $1 FOR UPDATE", [userId]); // serialize one user's reports
    const recent = await c.query(
      "SELECT 1 FROM venue_reports WHERE user_id = $1 AND venue_id = $2 AND created_at > now() - interval '15 minutes'",
      [userId, venueId],
    );
    if (recent.rowCount) throw new AuthError("You reported this venue in the last 15 minutes. Thanks!", 429);
    await c.query("INSERT INTO venue_reports (report_id, venue_id, user_id, metric, value) VALUES ($1,$2,$3,$4,$5)", [
      `vr-${crypto.randomUUID()}`,
      venueId,
      userId,
      metric,
      Math.round(value * 10) / 10,
    ]);
    return { ok: true };
  });
}

export type Rule = {
  venue_id: string;
  venue: string;
  metric: string;
  op: string;
  threshold: number;
  window_start: string;
  window_end: string;
  agg: string;
  series: { t: number; v: number; source: string }[];
  baseline: { p25: number; p50: number; p75: number } | null;
  sources: string[];
};

/** Settlement rule for a Union market plus the metric around its window (Lakebase) and its typical level (gold). */
export function marketRule(marketId: string): Promise<Rule | null> {
  return ifConnected(() => loadRule(marketId), null);
}

async function loadRule(marketId: string): Promise<Rule | null> {
  const [r] = await q<Omit<Rule, "series" | "baseline" | "sources">>(
    `SELECT r.venue_id, v.name AS venue, r.metric, r.op, r.threshold, r.window_start, r.window_end, r.agg
     FROM market_rules r JOIN venues v USING (venue_id) WHERE r.market_id = $1`,
    [marketId],
  );
  if (!r) return null;
  const [series, base] = await Promise.all([
    q<{ t: number; v: number; source: string }>(
      `SELECT (extract(epoch FROM observed_at) * 1000)::float8 AS t, value AS v, source FROM venue_metrics
       WHERE venue_id = $1 AND metric = $2 AND observed_at BETWEEN $3::timestamptz - interval '3 hours' AND $4::timestamptz + interval '1 hour'
       ORDER BY observed_at`,
      [r.venue_id, r.metric, r.window_start, r.window_end],
    ),
    querySql<{ p25: number; p50: number; p75: number }>(
      `SELECT p25, p50, p75 FROM {catalog}.gold.venue_baselines WHERE venue_id = :v AND metric = :m
       AND dow = dayofweek(from_utc_timestamp(:t, 'America/Chicago')) AND hour = hour(from_utc_timestamp(:t, 'America/Chicago'))`,
      { v: r.venue_id, m: r.metric, t: new Date(r.window_start).toISOString() },
    ).catch(() => []),
  ]);
  return { ...r, series, baseline: base[0] ?? null, sources: [...new Set(series.map((s) => s.source))] };
}

// ------------------------------------------------------------------ enterprise partners

const partnerEmails = () =>
  (process.env.PARTNER_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

/** Admins and partner staff (PARTNER_EMAILS secret) see the partner dashboard. */
export const canSeePartners = (u: { email: string }) => isAdmin(u) || partnerEmails().includes(u.email.toLowerCase());

type Partner = { partner_id: string; name: string; venue_ids: string[] };

/** Partner from `Authorization: Bearer <key>`; only the key's SHA-256 is stored. */
export async function partnerFromRequest(): Promise<Partner> {
  const auth = (await headers()).get("authorization") ?? "";
  const key = auth.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!key) throw new AuthError("Send your partner API key as Authorization: Bearer <key>.", 401);
  const rows = await q<Partner>(
    `UPDATE partners SET last_used_at = now() WHERE api_key_hash = $1 AND revoked_at IS NULL
     RETURNING partner_id, name, venue_ids`,
    [sha256(key)],
  );
  if (!rows[0]) throw new AuthError("Invalid or revoked API key.", 401);
  return rows[0];
}

const RANGES: Record<string, [number, number]> = {
  people: [0, 20000],
  occupancy_pct: [0, 150],
  wait_min: [0, 240],
  line_len: [0, 1000],
  sales: [0, 1_000_000],
};

/** Ingest point-of-sale / sensor readings from a partner (source = 'partner'). Idempotent per venue/metric/time. */
export async function ingestPartnerMetrics(p: Partner, body: unknown) {
  const rows = Array.isArray(body) ? body : (body as { readings?: unknown })?.readings;
  if (!Array.isArray(rows) || rows.length === 0) throw new AuthError("Send a JSON array of readings (or { readings: [...] }).");
  if (rows.length > 1000) throw new AuthError("At most 1000 readings per request.", 413);
  const clean = rows.map((r: Record<string, unknown>, i) => {
    const venue = String(r.venue_id ?? "");
    const metric = String(r.metric ?? "");
    const value = Number(r.value);
    const at = Date.parse(String(r.observed_at ?? ""));
    if (!p.venue_ids.includes(venue)) throw new AuthError(`Reading ${i}: this key can't write venue "${venue}".`, 403);
    if (!METRICS.has(metric)) throw new AuthError(`Reading ${i}: metric must be one of ${[...METRICS].join(", ")}.`);
    const [lo, hi] = RANGES[metric];
    if (!Number.isFinite(value) || value < lo || value > hi) throw new AuthError(`Reading ${i}: ${metric} must be ${lo}–${hi}.`);
    if (!Number.isFinite(at) || at > Date.now() + 5 * 60e3 || at < Date.now() - 7 * 86400e3)
      throw new AuthError(`Reading ${i}: observed_at must be an ISO time within the last 7 days.`);
    return [venue, metric, value, new Date(at).toISOString()] as const;
  });
  const r = await q<{ n: number }>(
    `WITH ins AS (
       INSERT INTO venue_metrics (venue_id, metric, value, observed_at, source, is_simulated)
       SELECT v, m, x, t, 'partner', false FROM unnest($1::text[], $2::text[], $3::float8[], $4::timestamptz[]) AS u(v, m, x, t)
       ON CONFLICT DO NOTHING RETURNING 1)
     SELECT count(*)::int AS n FROM ins`,
    [clean.map((c) => c[0]), clean.map((c) => c[1]), clean.map((c) => c[2]), clean.map((c) => c[3])],
  );
  return { accepted: r[0].n, duplicates: clean.length - r[0].n };
}

/** The crowd forecast for a partner's venues: live and settled Union markets with the chance of Yes. */
export async function partnerForecasts(venueIds: string[]) {
  const rows = await q<{
    market_id: string;
    question: string;
    status: string;
    venue_id: string;
    metric: string;
    op: string;
    threshold: number;
    window_start: string;
    winning_outcome_index: number | null;
    liquidity_b: number;
    q: number[];
  }>(
    `SELECT m.market_id, m.question, m.status, r.venue_id, r.metric, r.op, r.threshold, r.window_start,
            res.winning_outcome_index, m.liquidity_b, array_agg(o.q_shares ORDER BY o.outcome_index) AS q
     FROM market_rules r JOIN markets m USING (market_id) JOIN outcomes o USING (market_id)
     LEFT JOIN resolutions res USING (market_id)
     WHERE r.venue_id = ANY($1) AND r.window_start > now() - interval '7 days'
     GROUP BY m.market_id, m.question, m.status, r.venue_id, r.metric, r.op, r.threshold, r.window_start,
              res.winning_outcome_index, m.liquidity_b
     ORDER BY r.window_start DESC`,
    [venueIds],
  );
  return rows.map(({ liquidity_b, q: qs, ...m }) => ({
    ...m,
    chance_yes: Math.round(prices(qs, liquidity_b)[0] * 1000) / 1000,
    outcome: m.winning_outcome_index == null ? null : m.winning_outcome_index === 0 ? "yes" : "no",
  }));
}

export async function listPartners() {
  return ifConnected(() => q<{ partner_id: string; name: string; venue_ids: string[]; created_at: string; last_used_at: string | null; revoked_at: string | null }>(
    "SELECT partner_id, name, venue_ids, created_at, last_used_at, revoked_at FROM partners ORDER BY created_at DESC",
  ), []);
}

/** New partner API key. Returned once; only its hash is stored. */
export async function createPartner(name: unknown, venueIds: unknown) {
  const n = String(name ?? "").trim().slice(0, 80);
  const ids = Array.isArray(venueIds) ? venueIds.map(String) : [];
  if (!n) throw new AuthError("Give the partner a name.");
  const known = (await q<{ venue_id: string }>("SELECT venue_id FROM venues WHERE venue_id = ANY($1)", [ids])).map((v) => v.venue_id);
  if (!known.length || known.length !== ids.length) throw new AuthError("Pick at least one venue (and only known venues).");
  const key = `yomi_pk_${randomBytes(24).toString("base64url")}`;
  const id = `p-${crypto.randomUUID()}`;
  await q("INSERT INTO partners (partner_id, name, api_key_hash, venue_ids) VALUES ($1, $2, $3, $4)", [id, n, sha256(key), known]);
  return { partner_id: id, name: n, venue_ids: known, api_key: key };
}

export async function revokePartner(id: string) {
  await q("UPDATE partners SET revoked_at = now() WHERE partner_id = $1 AND revoked_at IS NULL", [id]);
}

/** Partner scorecard from gold: crowd vs venue history (Brier), and recent settled markets. */
export async function unionScorecard() {
  const [accuracy, recent] = await Promise.all([
    querySql<{ venue_id: string; venue: string; n_markets: number; crowd_brier: number; history_brier: number; crowd_edge: number }>(
      "SELECT venue_id, venue, n_markets, crowd_brier, history_brier, crowd_edge FROM {catalog}.gold.union_accuracy ORDER BY venue_id = '__all__' DESC, venue",
    ).catch(() => []),
    querySql<{ market_id: string; venue: string; question: string; crowd_p: number; history_p: number; yes: number; is_simulated: boolean; t: number }>(
      `SELECT market_id, venue, question, crowd_p, history_p, yes, is_simulated, unix_millis(window_start) AS t
       FROM {catalog}.gold.union_market_scores ORDER BY window_start DESC LIMIT 30`,
    ).catch(() => []),
  ]);
  return { accuracy, recent };
}
