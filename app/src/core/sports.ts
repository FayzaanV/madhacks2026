// Varsity sports markets: parse ESPN's public scoreboard JSON, decide which markets a game gets, and settle them.
// Pure functions (no I/O) so they're unit-tested against recorded ESPN events in ./fixtures.
// Team props only: markets are about teams, never individual players (CLAUDE.md: no markets about individual students).
import { UNIVERSITIES } from "./universities";

export type SportKey = "football" | "mens-basketball" | "womens-basketball" | "mens-hockey" | "womens-hockey" | "womens-volleyball";

type SportConfig = {
  path: string; // ESPN path under /apis/site/v2/sports/
  label: string;
  unit: string; // what the total market counts
  regulationPeriods: number | null; // more periods than this = overtime
  overtime: boolean; // gets an overtime market
  margins: [number, number | null][]; // winning-margin buckets (inclusive), null = and up
  defaultTotal: number; // fallback over/under line before there's history
};

export const SPORTS: Record<SportKey, SportConfig> = {
  football: {
    path: "football/college-football", label: "Football", unit: "points", regulationPeriods: 4, overtime: true,
    margins: [[1, 7], [8, 14], [15, null]], defaultTotal: 48.5,
  },
  "mens-basketball": {
    path: "basketball/mens-college-basketball", label: "Men's Basketball", unit: "points", regulationPeriods: 2, overtime: true,
    margins: [[1, 5], [6, 10], [11, null]], defaultTotal: 142.5,
  },
  "womens-basketball": {
    path: "basketball/womens-college-basketball", label: "Women's Basketball", unit: "points", regulationPeriods: 4, overtime: true,
    margins: [[1, 5], [6, 10], [11, null]], defaultTotal: 132.5,
  },
  "mens-hockey": {
    path: "hockey/mens-college-hockey", label: "Men's Hockey", unit: "goals", regulationPeriods: 3, overtime: true,
    margins: [[1, 1], [2, 2], [3, null]], defaultTotal: 5.5,
  },
  "womens-hockey": {
    path: "hockey/womens-college-hockey", label: "Women's Hockey", unit: "goals", regulationPeriods: 3, overtime: true,
    margins: [[1, 1], [2, 2], [3, null]], defaultTotal: 5.5,
  },
  "womens-volleyball": {
    path: "volleyball/womens-college-volleyball", label: "Volleyball", unit: "sets", regulationPeriods: null, overtime: false,
    margins: [[3, 3], [2, 2], [1, 1]], defaultTotal: 3.5, // set margin: 3-0, 3-1, 3-2
  },
};

/** Statuses that mean the game won't be played as scheduled: void every market on it. */
const VOID_STATUSES = new Set(["STATUS_POSTPONED", "STATUS_CANCELED", "STATUS_FORFEIT", "STATUS_ABANDONED", "STATUS_SUSPENDED"]);

const SCHOOL_BY_ESPN = new Map(
  UNIVERSITIES.filter((u) => u.espn_id).map((u) => [u.espn_id!, u]),
);

export type Side = {
  espnId: string;
  name: string;
  short: string;
  abbr: string;
  schoolId: string | null; // our school when the team is a listed (Big Ten) school
  score: number | null;
  winner: boolean | null;
};

export type Game = {
  eventId: string;
  sport: SportKey;
  startsAt: string;
  state: "pre" | "in" | "post";
  statusName: string;
  completed: boolean;
  period: number | null;
  clock: string | null;
  detail: string;
  home: Side;
  away: Side;
  winnerSide: "home" | "away" | null;
  overtime: boolean;
  ouLine: number | null;
};

const num = (v: unknown): number | null => {
  if (v == null) return null;
  if (typeof v === "object") return num((v as { value?: unknown }).value);
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

type EspnCompetitor = {
  homeAway: "home" | "away";
  score?: unknown;
  winner?: boolean | null;
  team: { id: string; displayName: string; shortDisplayName?: string; location?: string; abbreviation?: string };
};
type EspnEvent = {
  id: string;
  date: string;
  status?: { period?: number; displayClock?: string; type: { name: string; state: string; completed: boolean; detail?: string; shortDetail?: string } };
  competitions: { date?: string; status?: EspnEvent["status"]; odds?: { overUnder?: number }[]; competitors: EspnCompetitor[] }[];
};

/** Normalize one ESPN event (scoreboard or team-schedule shape). */
export function parseEvent(sport: SportKey, ev: EspnEvent): Game {
  const comp = ev.competitions[0];
  const status = ev.status ?? comp.status!;
  const side = (c: EspnCompetitor): Side => ({
    espnId: String(c.team.id),
    name: c.team.displayName,
    short: c.team.location || c.team.shortDisplayName || c.team.displayName,
    abbr: c.team.abbreviation ?? c.team.displayName,
    schoolId: SCHOOL_BY_ESPN.get(String(c.team.id))?.school_id ?? null,
    score: num(c.score),
    winner: c.winner ?? null,
  });
  const home = side(comp.competitors.find((c) => c.homeAway === "home") ?? comp.competitors[0]);
  const away = side(comp.competitors.find((c) => c.homeAway === "away") ?? comp.competitors[1]);
  const t = status.type;
  const state = (["pre", "in", "post"].includes(t.state) ? t.state : "pre") as Game["state"];
  const reg = SPORTS[sport].regulationPeriods;
  const detail = t.detail ?? t.shortDetail ?? "";
  const winnerSide = home.winner ? "home" : away.winner ? "away" : null;
  return {
    eventId: String(ev.id),
    sport,
    startsAt: comp.date ?? ev.date,
    state,
    statusName: t.name,
    completed: Boolean(t.completed),
    period: status.period ?? null,
    clock: status.displayClock ?? null,
    detail,
    home,
    away,
    winnerSide,
    overtime: /\b(OT|SO)\b|\dOT/.test(detail) || (reg != null && (status.period ?? 0) > reg),
    ouLine: num(comp.odds?.[0]?.overUnder),
  };
}

export type MarketKind = "winner" | "total" | "margin" | "overtime";
export type MarketSpec = {
  kind: MarketKind;
  question: string;
  outcomes: string[];
  line: number | null;
  focus: "home" | "away"; // the team the question is phrased around
  schoolId: string;
};

/** Over/under line from past combined totals: their mean rounded to the nearest .5 so a game can't land on it. */
export function totalLine(sport: SportKey, pastTotals: number[]): number {
  if (!pastTotals.length) return SPORTS[sport].defaultTotal;
  const mean = pastTotals.reduce((a, x) => a + x, 0) / pastTotals.length;
  return Math.floor(mean) + 0.5;
}

const bucketLabel = (team: string, [lo, hi]: [number, number | null], sport: SportKey) =>
  sport === "womens-volleyball" ? `${team} 3–${3 - lo}` : hi == null ? `${team} by ${lo}+` : lo === hi ? `${team} by ${lo}` : `${team} by ${lo}–${hi}`;

/**
 * Markets for one game that involves at least one listed school. Phrased around the listed school
 * (the home team when both are listed, so a Big Ten matchup gets one set of markets, not two).
 */
export function marketsForGame(g: Game, line: number): MarketSpec[] {
  const focus: "home" | "away" = g.home.schoolId ? "home" : g.away.schoolId ? "away" : "home";
  const us = g[focus];
  const them = g[focus === "home" ? "away" : "home"];
  if (!us.schoolId) return [];
  const cfg = SPORTS[g.sport];
  const day = new Date(g.startsAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
  const vs = `${g.away.short} at ${g.home.short} (${day})`;
  const specs: MarketSpec[] = [
    {
      kind: "winner",
      question: `${cfg.label}: Will ${us.short} beat ${them.short}? (${day})`,
      outcomes: ["Yes", "No"],
      line: null,
      focus,
      schoolId: us.schoolId,
    },
    {
      kind: "total",
      question: `${cfg.label}: Over ${line} total ${cfg.unit} in ${vs}?`,
      outcomes: ["Yes", "No"],
      line,
      focus,
      schoolId: us.schoolId,
    },
    {
      kind: "margin",
      question: `${cfg.label}: Winning margin in ${vs}?`,
      outcomes: [...cfg.margins.map((b) => bucketLabel(us.short, b, g.sport)), ...cfg.margins.map((b) => bucketLabel(them.short, b, g.sport))],
      line: null,
      focus,
      schoolId: us.schoolId,
    },
  ];
  if (cfg.overtime)
    specs.push({
      kind: "overtime",
      question: `${cfg.label}: Will ${vs} go to overtime?`,
      outcomes: ["Yes", "No"],
      line: null,
      focus,
      schoolId: us.schoolId,
    });
  return specs;
}

/**
 * Winning outcome index for a market once its game is final, "void" if the game won't count, or null if it
 * isn't decided yet. Ties (possible in college hockey) void the winner and margin markets.
 */
export function resolveOutcome(spec: Pick<MarketSpec, "kind" | "line" | "focus">, g: Game): number | "void" | null {
  if (VOID_STATUSES.has(g.statusName)) return "void";
  if (g.state !== "post" || !g.completed) return null;
  const hs = g.home.score;
  const as = g.away.score;
  if (hs == null || as == null) return "void";
  const us = spec.focus === "home" ? hs : as;
  const them = spec.focus === "home" ? as : hs;
  const cfg = SPORTS[g.sport];
  switch (spec.kind) {
    case "winner":
      if (us === them) return "void";
      return us > them ? 0 : 1;
    case "total":
      if (spec.line == null) return "void";
      return hs + as > spec.line ? 0 : 1;
    case "overtime":
      return g.overtime ? 0 : 1;
    case "margin": {
      const diff = Math.abs(us - them);
      if (diff === 0) return "void";
      const i = cfg.margins.findIndex(([lo, hi]) => diff >= lo && (hi == null || diff <= hi));
      if (i < 0) return "void";
      return us > them ? i : cfg.margins.length + i;
    }
  }
}

/** One-line live status for cards: "WIS 21 – MD 24 · Final", "MSU 14 – WASH 21 · 2nd 4:31". */
export function scoreLine(g: Pick<Game, "home" | "away" | "state" | "detail" | "startsAt">): string {
  if (g.state === "pre")
    return new Date(g.startsAt).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }) + " CT";
  return `${g.away.abbr} ${g.away.score ?? 0} – ${g.home.abbr} ${g.home.score ?? 0} · ${g.detail}`;
}
