// Intramural result flow (FusionPlay has no public data, so captains report and the opponent confirms).
// Pure rules, unit-tested; app/src/server/intramurals.ts does the I/O.

export const AUTO_CONFIRM_HOURS = 2;

export type ImStatus = "scheduled" | "reported" | "disputed" | "final" | "forfeit" | "canceled";
export type ImGame = {
  status: ImStatus;
  starts_at: string;
  home_captain: string | null;
  away_captain: string | null;
  reported_by: string | null;
};

export type Action = "report" | "confirm" | "dispute";

/** Why `userId` can't take `action` on this game, or null if allowed. */
export function denyReason(g: ImGame, userId: string, action: Action, now = Date.now()): string | null {
  const side = userId === g.home_captain ? "home" : userId === g.away_captain ? "away" : null;
  if (!side) return "Only the two teams' captains can report or confirm results.";
  if (now < Date.parse(g.starts_at)) return "The game hasn't started yet.";
  switch (action) {
    case "report":
      if (g.status === "scheduled") return null;
      if (g.status === "reported" && g.reported_by === userId) return null; // fix your own report before it's confirmed
      return g.status === "reported" ? "The other captain already reported; confirm or dispute it." : `This game is ${g.status}.`;
    case "confirm":
    case "dispute":
      if (g.status !== "reported") return "There's no reported score to respond to.";
      if (g.reported_by === userId) return "The other team's captain has to confirm your report.";
      return null;
  }
}

/** Market outcome for "Will HOME beat AWAY?": 0 = Yes, 1 = No, a tie or cancellation voids. */
export function winnerOutcome(status: ImStatus, home: number | null, away: number | null): 0 | 1 | "void" {
  if (status === "canceled" || home == null || away == null || home === away) return "void";
  return home > away ? 0 : 1;
}

export function validScore(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 999;
}

/** Parse "date,time,home,away,location" lines (header row optional). Times are Central (America/Chicago). */
export type ScheduleRow = { date: string; time: string; home: string; away: string; location: string | null };
export function parseSchedule(csv: string): { rows: ScheduleRow[]; errors: string[] } {
  const rows: ScheduleRow[] = [];
  const errors: string[] = [];
  csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line, i) => {
      const [date, time, home, away, location] = line.split(",").map((x) => x?.trim() ?? "");
      if (i === 0 && /^date$/i.test(date)) return; // header
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return errors.push(`Line ${i + 1}: date must be YYYY-MM-DD`);
      if (!/^\d{1,2}:\d{2}$/.test(time)) return errors.push(`Line ${i + 1}: time must be HH:MM (24h)`);
      if (!home || !away || home === away) return errors.push(`Line ${i + 1}: needs two different team names`);
      rows.push({ date, time, home: home.slice(0, 60), away: away.slice(0, 60), location: location || null });
    });
  return { rows, errors };
}

/** "2026-11-18" + "19:30" in Chicago -> UTC ISO string (handles CST/CDT). */
export function chicagoToIso(date: string, time: string): string {
  const [h, m] = time.split(":").map(Number);
  const guess = new Date(`${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", timeZoneName: "shortOffset" })
    .formatToParts(guess)
    .find((p) => p.type === "timeZoneName")!.value; // e.g. "GMT-6"
  const hours = Number(offset.replace("GMT", "") || 0);
  return new Date(guess.getTime() - hours * 3600e3).toISOString();
}
