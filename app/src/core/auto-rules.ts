// Auto-resolving campus markets: weather (Open-Meteo) and rec-center crowding (UW Rec Well live counts).
// Pure logic only (no I/O), so it is unit-tested in core.test.ts. The server side lives in server/campus-data.ts.
// Every auto market is binary: outcome 0 = "Yes" (the rule holds), outcome 1 = "No".

export type Op = ">" | ">=" | "<" | "<=";
export const OPS: Op[] = [">=", ">", "<=", "<"];

export const WEATHER_METRICS = {
  temp_max_f: { label: "high temperature", unit: "°F", openMeteo: "temperature_2m_max" },
  temp_min_f: { label: "low temperature", unit: "°F", openMeteo: "temperature_2m_min" },
  precip_in: { label: "total rain + melted snow", unit: "in", openMeteo: "precipitation_sum" },
  snow_in: { label: "snowfall", unit: "in", openMeteo: "snowfall_sum" },
} as const;
export type WeatherMetric = keyof typeof WEATHER_METRICS;

/** Madison, WI (Bascom Hill). */
export const MADISON = { latitude: 43.075, longitude: -89.404 };

export type WeatherRule = { kind: "weather"; metric: WeatherMetric; date: string; op: Op; threshold: number };
export type FacilityRule = {
  kind: "facility";
  location_id: number;
  location_name: string;
  at: string; // ISO instant the count is checked
  op: Op;
  threshold: number;
  unit: "count" | "percent";
};
export type AutoRule = WeatherRule | FacilityRule;

/** A count update counts as "at" the check time if it was taken within this many minutes of it. */
export const READING_WINDOW_MIN = 45;
/** Weather is checked the morning after the day, once the day's data is complete. */
const WEATHER_SETTLE_HOURS = 30; // hours after local midnight that starts the day = 6:00 AM the next day

export const compare = (value: number, op: Op, threshold: number) => {
  if (op === ">") return value > threshold;
  if (op === ">=") return value >= threshold;
  if (op === "<") return value < threshold;
  return value <= threshold;
};

/** Outcome index: 0 = Yes (rule holds), 1 = No. */
export const winnerFor = (rule: AutoRule, value: number) => (compare(value, rule.op, rule.threshold) ? 0 : 1);

const OP_WORDS: Record<Op, string> = { ">": "more than", ">=": "at least", "<": "fewer than", "<=": "at most" };
const OP_WORDS_AMOUNT: Record<Op, string> = { ">": "above", ">=": "at least", "<": "below", "<=": "at most" };

/** Offset in minutes of America/Chicago from UTC at a given instant (handles daylight saving). */
export function chicagoOffsetMin(atMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(atMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUtc - Math.floor(atMs / 60000) * 60000) / 60000);
}

/** Midnight that starts YYYY-MM-DD in Madison, as epoch ms. */
export function chicagoMidnight(date: string): number {
  const guess = Date.parse(`${date}T00:00:00Z`);
  return guess - chicagoOffsetMin(guess + 12 * 3600e3) * 60000;
}

/** Parse the rec feed's local timestamps ("2026-11-14T16:10:46.63", Madison time, no zone) to epoch ms. */
export function parseChicagoLocal(s: string): number {
  const guess = Date.parse(`${s.replace(" ", "T")}Z`);
  return guess - chicagoOffsetMin(guess) * 60000;
}

const fmtTime = (ms: number) =>
  new Date(ms).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const fmtDay = (date: string) =>
  new Date(chicagoMidnight(date) + 12 * 3600e3).toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric" });

/** Suggested question text for the market form. */
export function suggestQuestion(rule: AutoRule): string {
  if (rule.kind === "weather") {
    const m = WEATHER_METRICS[rule.metric];
    return `Will Madison's ${m.label} on ${fmtDay(rule.date)} be ${OP_WORDS_AMOUNT[rule.op]} ${rule.threshold}${m.unit}?`;
  }
  const amount = rule.unit === "percent" ? `${rule.threshold}% full` : `${rule.threshold} people`;
  const verb = rule.unit === "percent" ? `be ${OP_WORDS_AMOUNT[rule.op]}` : `have ${OP_WORDS[rule.op]}`;
  return `Will ${rule.location_name} ${verb} ${amount} at ${fmtTime(Date.parse(rule.at))}?`;
}

/** One line for the market page: how the market settles. */
export function describeRule(rule: AutoRule): string {
  if (rule.kind === "weather") {
    const m = WEATHER_METRICS[rule.metric];
    return `Resolves Yes if Open-Meteo's ${m.label} for Madison on ${fmtDay(rule.date)} is ${rule.op} ${rule.threshold}${m.unit}. Settled automatically the next morning.`;
  }
  const unit = rule.unit === "percent" ? "% of capacity" : " people";
  return `Resolves Yes if the UW Rec Well live count for ${rule.location_name} is ${rule.op} ${rule.threshold}${unit} at ${fmtTime(Date.parse(rule.at))} (the count update closest to that time, within ${READING_WINDOW_MIN} minutes).`;
}

/** Trading must close before anyone can see the answer. */
export function latestClose(rule: AutoRule): number {
  return rule.kind === "weather" ? chicagoMidnight(rule.date) : Date.parse(rule.at);
}

/** When the auto-resolver may settle the market. */
export function resolvableAt(rule: AutoRule): number {
  return rule.kind === "weather"
    ? chicagoMidnight(rule.date) + WEATHER_SETTLE_HOURS * 3600e3
    : Date.parse(rule.at) + READING_WINDOW_MIN * 60e3;
}

export type Reading = { last_count: number; capacity: number; is_closed: boolean; source_updated_at: string };

/** The count update closest to the check time, within the window; closed rooms don't count. */
export function pickReading<T extends Reading>(readings: readonly T[], atMs: number): T | null {
  let best: T | null = null;
  let bestGap = Infinity;
  for (const r of readings) {
    if (r.is_closed) continue;
    const gap = Math.abs(Date.parse(r.source_updated_at) - atMs);
    if (gap <= READING_WINDOW_MIN * 60e3 && gap < bestGap) {
      best = r;
      bestGap = gap;
    }
  }
  return best;
}

export const readingValue = (rule: FacilityRule, r: Reading) =>
  rule.unit === "percent" ? (r.capacity > 0 ? (100 * r.last_count) / r.capacity : 0) : r.last_count;

/** Check an untrusted rule from the market form. Returns the cleaned rule or an error message. */
export function validateRule(raw: unknown, now = Date.now()): { rule: AutoRule } | { error: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const op = String(r.op) as Op;
  const threshold = Number(r.threshold);
  if (!OPS.includes(op)) return { error: "Pick a comparison (≥, >, ≤, <)." };
  if (!Number.isFinite(threshold)) return { error: "Enter a number to compare against." };
  if (r.kind === "weather") {
    const metric = String(r.metric) as WeatherMetric;
    const date = String(r.date ?? "");
    if (!(metric in WEATHER_METRICS)) return { error: "Pick a weather measurement." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Pick the day the weather is for." };
    const start = chicagoMidnight(date);
    if (start < now + 10 * 60e3) return { error: "Weather markets have to be about a future day." };
    if (start > now + 15 * 86400e3) return { error: "Open-Meteo forecasts reach about 2 weeks ahead; pick a closer day." };
    return { rule: { kind: "weather", metric, date, op, threshold } };
  }
  if (r.kind === "facility") {
    const location_id = Number(r.location_id);
    const location_name = String(r.location_name ?? "").trim().slice(0, 80);
    const at = Date.parse(String(r.at ?? ""));
    const unit = r.unit === "percent" ? "percent" : "count";
    if (!Number.isInteger(location_id) || !location_name) return { error: "Pick a rec center space." };
    if (!Number.isFinite(at) || at < now + 10 * 60e3) return { error: "Pick a check time at least 10 minutes from now." };
    if (at > now + 60 * 86400e3) return { error: "Pick a check time within 60 days." };
    if (threshold < 0 || (unit === "percent" && threshold > 100)) return { error: "That threshold isn't possible." };
    return { rule: { kind: "facility", location_id, location_name, at: new Date(at).toISOString(), op, threshold, unit } };
  }
  return { error: "Unknown auto-resolution type." };
}
