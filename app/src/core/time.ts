// Dates and times in Madison time. The deployed server runs in UTC, so formatting must never depend on the
// machine's timezone or locale: server and browser render identical text (no hydration mismatches).

export const TZ = "America/Chicago";

const f = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, ...opts });
const DATE = f({ month: "short", day: "numeric" });
const DATE_Y = f({ month: "short", day: "numeric", year: "numeric" });
const TIME = f({ hour: "numeric", minute: "2-digit" });
const PARTS = f({ year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

type When = string | number | Date;
const d = (x: When) => (x instanceof Date ? x : new Date(x));

/** "Nov 14" */
export const fmtDate = (x: When) => DATE.format(d(x));
/** "Nov 14, 2026" */
export const fmtDateYear = (x: When) => DATE_Y.format(d(x));
/** "7:30 PM CT" */
export const fmtTime = (x: When) => `${TIME.format(d(x))} CT`;
/** "Nov 14, 7:30 PM CT" */
export const fmtDateTime = (x: When) => `${DATE.format(d(x))}, ${fmtTime(x)}`;
/** Axis label: time if within a day of `ref`, else date. */
export const fmtShort = (x: When, spanMs: number) => (spanMs < 36 * 3600e3 ? TIME.format(d(x)) : DATE.format(d(x)));

/** Madison wall-clock parts of an instant. */
export function madisonParts(x: When) {
  const p = Object.fromEntries(PARTS.formatToParts(d(x)).map((v) => [v.type, v.value]));
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, second: +p.second };
}

/** Offset of Madison time from UTC at an instant, in ms (e.g. -6h in winter, -5h in summer). */
function offsetMs(at: number) {
  const p = madisonParts(at);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at / 1000) * 1000;
}

/** A Madison wall-clock time ("2026-11-14T19:30" from a datetime-local input) as a UTC instant. */
export function fromMadison(local: string): Date {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return new Date(NaN);
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  // Apply the offset at the guess, then once more in case the guess crossed a DST boundary.
  const first = guess - offsetMs(guess);
  return new Date(guess - offsetMs(first));
}

/** UTC instant of today's (or the given day's) Madison wall-clock hour:minute. */
export function madisonAt(day: When, hour: number, minute = 0): Date {
  const p = madisonParts(day);
  const pad = (n: number) => String(n).padStart(2, "0");
  return fromMadison(`${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(hour)}:${pad(minute)}`);
}
