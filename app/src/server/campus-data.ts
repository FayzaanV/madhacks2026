import "server-only";
import {
  MADISON,
  WEATHER_METRICS,
  parseChicagoLocal,
  pickReading,
  readingValue,
  resolvableAt,
  winnerFor,
  type AutoRule,
  type FacilityRule,
  type WeatherRule,
} from "@/core/auto-rules";
import { q } from "./ledger";
import { settleMarket } from "./markets";
import { querySql } from "./warehouse";

/**
 * Campus data for auto-resolving markets (rule logic in core/auto-rules.ts):
 * - UW Rec Well live counts: the public widget at connect2mycloud.com reads this JSON feed. It only has the
 *   current count, so pollOnce() saves every count update to Lakebase `facility_counts` (the history), which syncs
 *   to bronze and feeds gold.facility_busyness (typical crowd by weekday and hour).
 *   Free Edition Databricks can't reach the feed (tested 2026-11-14), so a laptop running the app does it
 *   (the "laptop relay", see CLAUDE.md). Saving is idempotent, so every instance just tries.
 * - Weather: Open-Meteo daily values for Madison. The yomi-refresh task campus_weather (Databricks CAN reach
 *   Open-Meteo) saves them to Lakebase `weather_observations`; settling reads that row and only fetches directly
 *   if it's missing (works from a laptop).
 * pollers.ts runs pollOnce() every 5 minutes in every app instance; admins can run it now via POST /api/campus/sync.
 * Settling twice is safe: settleMarket locks the market and refuses one that's already settled.
 */

// The account key UW Rec Well publishes in its public live-count widget (not a secret).
const REC_KEY = process.env.REC_COUNTS_KEY ?? "7938fc89-a15c-492d-9566-12c961bc1f27";
const REC_FEED = `https://goboardapi.azurewebsites.net/api/FacilityCount/GetCountsByAccount?AccountAPIKey=${REC_KEY}`;

type FeedRow = {
  LocationId: number;
  LocationName: string;
  FacilityName: string;
  LastCount: number;
  TotalCapacity: number;
  IsClosed: boolean;
  LastUpdatedDateAndTime: string;
};

export type FacilityNow = {
  location_id: number;
  location_name: string;
  facility_name: string;
  last_count: number;
  capacity: number;
  is_closed: boolean;
  source_updated_at: string; // ISO
};

/** Current counts straight from the feed. */
export async function fetchFacilities(): Promise<FacilityNow[]> {
  const res = await fetch(REC_FEED, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`rec counts feed -> ${res.status}`);
  const rows = (await res.json()) as FeedRow[];
  return rows.map((r) => ({
    location_id: r.LocationId,
    location_name: r.LocationName.trim(),
    facility_name: r.FacilityName.trim(),
    last_count: Math.max(0, Math.round(r.LastCount)),
    capacity: Math.max(0, Math.round(r.TotalCapacity)),
    is_closed: Boolean(r.IsClosed),
    source_updated_at: new Date(parseChicagoLocal(r.LastUpdatedDateAndTime)).toISOString(),
  }));
}

/** Save the current counts; a count the rec center hasn't updated since the last poll is skipped. */
export async function snapshotFacilities(): Promise<number> {
  const rows = await fetchFacilities();
  const saved = await q<{ n: number }>(
    `WITH ins AS (
       INSERT INTO facility_counts (location_id, location_name, facility_name, last_count, capacity, is_closed, source_updated_at)
       SELECT * FROM unnest($1::int[], $2::text[], $3::text[], $4::int[], $5::int[], $6::bool[], $7::timestamptz[])
       ON CONFLICT (location_id, source_updated_at) DO NOTHING RETURNING 1)
     SELECT count(*)::int AS n FROM ins`,
    [
      rows.map((r) => r.location_id),
      rows.map((r) => r.location_name),
      rows.map((r) => r.facility_name),
      rows.map((r) => r.last_count),
      rows.map((r) => r.capacity),
      rows.map((r) => r.is_closed),
      rows.map((r) => r.source_updated_at),
    ],
  );
  return saved[0]?.n ?? 0;
}

/** Daily value for Madison from Open-Meteo, saved to weather_observations. */
export async function fetchWeather(rule: WeatherRule): Promise<number | null> {
  const field = WEATHER_METRICS[rule.metric].openMeteo;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${MADISON.latitude}&longitude=${MADISON.longitude}` +
    `&daily=${field}&start_date=${rule.date}&end_date=${rule.date}&timezone=America%2FChicago` +
    `&temperature_unit=fahrenheit&precipitation_unit=inch`;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`open-meteo -> ${res.status}`);
  const j = (await res.json()) as { daily?: Record<string, (number | null)[]> };
  const value = j.daily?.[field]?.[0];
  if (value == null || !Number.isFinite(value)) return null;
  await q(
    `INSERT INTO weather_observations (obs_date, metric, value) VALUES ($1, $2, $3)
     ON CONFLICT (obs_date, metric) DO UPDATE SET value = EXCLUDED.value, fetched_at = now()`,
    [rule.date, rule.metric, value],
  );
  return value;
}

const CAMPUS_BOT = "u-yomi-campus"; // system account in db/schema.sql

async function savedWeather(rule: WeatherRule): Promise<number | null> {
  const rows = await q<{ value: number }>("SELECT value FROM weather_observations WHERE obs_date = $1 AND metric = $2", [rule.date, rule.metric]);
  return rows[0]?.value ?? null;
}

async function facilityValue(rule: FacilityRule) {
  const at = Date.parse(rule.at);
  const readings = await q<{ last_count: number; capacity: number; is_closed: boolean; source_updated_at: string }>(
    `SELECT last_count, capacity, is_closed, source_updated_at FROM facility_counts
     WHERE location_id = $1 AND source_updated_at BETWEEN $2::timestamptz - interval '45 minutes' AND $2::timestamptz + interval '45 minutes'`,
    [rule.location_id, new Date(at).toISOString()],
  );
  const r = pickReading(
    readings.map((x) => ({ ...x, source_updated_at: new Date(x.source_updated_at).toISOString() })),
    at,
  );
  return r && { value: readingValue(rule, r), reading: r };
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/**
 * Settle every auto market whose data is in. Markets without a usable reading are left for an admin to resolve
 * (never voided automatically), and reported back as `waiting`.
 */
export async function autoResolveDue() {
  const due = await q<{ market_id: string; auto_rule: string }>(
    "SELECT market_id, auto_rule FROM markets WHERE auto_rule IS NOT NULL AND status IN ('live', 'closed')",
  );
  const resolved: { market_id: string; winner: string; value: number }[] = [];
  const waiting: { market_id: string; reason: string }[] = [];
  for (const m of due) {
    let rule: AutoRule;
    try {
      rule = JSON.parse(m.auto_rule) as AutoRule;
    } catch {
      waiting.push({ market_id: m.market_id, reason: "rule is not valid JSON" });
      continue;
    }
    if (Date.now() < resolvableAt(rule)) continue;
    try {
      let value: number | null = null;
      let note = "";
      if (rule.kind === "weather") {
        value = await savedWeather(rule);
        if (value == null) value = await fetchWeather(rule).catch(() => null);
        const m2 = WEATHER_METRICS[rule.metric];
        note = `Auto-resolved from Open-Meteo: Madison ${m2.label} on ${rule.date} was ${value == null ? "?" : fmt(value)}${m2.unit} (rule: ${rule.op} ${rule.threshold}${m2.unit}).`;
      } else {
        const got = await facilityValue(rule);
        if (got) {
          value = got.value;
          const when = new Date(got.reading.source_updated_at).toLocaleString("en-US", { timeZone: "America/Chicago" });
          note = `Auto-resolved from UW Rec Well live counts: ${rule.location_name} had ${got.reading.last_count} of ${got.reading.capacity} (count updated ${when})${rule.unit === "percent" ? `, ${fmt(value)}% full` : ""} (rule: ${rule.op} ${rule.threshold}${rule.unit === "percent" ? "%" : ""}).`;
        }
      }
      if (value == null) {
        waiting.push({
          market_id: m.market_id,
          reason: rule.kind === "weather"
            ? "no weather value yet (the yomi-refresh job saves it); an admin can resolve it by hand"
            : "no rec count near the check time (is the laptop relay running?); an admin can resolve it by hand",
        });
        continue;
      }
      const winner = winnerFor(rule, value);
      await settleMarket(m.market_id, winner, note, CAMPUS_BOT);
      resolved.push({ market_id: m.market_id, winner: winner === 0 ? "Yes" : "No", value });
    } catch (e) {
      waiting.push({ market_id: m.market_id, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return { resolved, waiting };
}

/** One poll: save rec counts, then settle anything due. Errors in one step don't stop the other. */
export async function pollOnce() {
  let saved = 0;
  let snapshotError: string | null = null;
  try {
    saved = await snapshotFacilities();
  } catch (e) {
    snapshotError = e instanceof Error ? e.message : String(e);
  }
  const settle = await autoResolveDue();
  return { facilityRowsSaved: saved, snapshotError, ...settle };
}

/**
 * Current count per space (market form + market pages): the last saved counts (kept fresh by whichever instance
 * can reach the feed), else the live feed directly (an empty table on a laptop).
 */
export async function latestFacilities(): Promise<FacilityNow[]> {
  const rows = await q<FacilityNow>(
    `SELECT DISTINCT ON (location_id) location_id, location_name, facility_name, last_count, capacity, is_closed,
            to_char(source_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS source_updated_at
     FROM facility_counts ORDER BY location_id, source_updated_at DESC`,
  );
  if (rows.length) return rows.sort((a, b) => a.location_name.localeCompare(b.location_name));
  return fetchFacilities();
}

/** Typical crowd for a space at that weekday and hour, from gold (Databricks). Null until there's history. */
export async function typicalCrowd(rule: FacilityRule): Promise<{ avg_count: number; avg_pct: number; n: number } | null> {
  const at = new Date(rule.at);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(at);
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((p) => p.type === "weekday")?.value ?? "") + 1;
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  try {
    const rows = await querySql<{ avg_count: number; avg_pct: number; n: number }>(
      `SELECT avg_count, avg_pct, n_readings AS n FROM {catalog}.gold.facility_busyness
       WHERE location_id = :loc AND day_of_week = :dow AND hour = :hour`,
      { loc: rule.location_id, dow, hour },
    );
    return rows[0] ?? null;
  } catch {
    return null; // gold table not built yet
  }
}
