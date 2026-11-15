// Test markets: simulated, clearly labeled [Test] markets that close tonight and resolve at random, so the team can
// try trading, selling, payouts and leaderboards on the live site. Pure helpers (tested in core.test.ts).
import { madisonAt } from "./time";

export type TestTemplate = { question: string; outcomes?: string[] };

export const TEST_TEMPLATES: TestTemplate[] = [
  { question: "Will it snow in Madison before midnight?" },
  { question: "Will Bascom Hill have a snowman by morning?" },
  { question: "Will the Badgers score 30+ points this weekend?" },
  { question: "Will the Library Mall food carts have a line over 10 people at noon tomorrow?" },
  { question: "Will College Library hit max capacity tonight?" },
  { question: "Will a squirrel steal someone's lunch on Library Mall today?" },
  { question: "Will Lake Mendota freeze over before Thanksgiving?" },
  { question: "Will Babcock release a new ice cream flavor this week?" },
  { question: "Which dining hall has the longest line at 6pm?", outcomes: ["Gordon", "Four Lakes", "Rheta's", "Liz's"] },
  { question: "How many people will be at the Sett at 9pm?", outcomes: ["Under 100", "100-250", "250-400", "400+"] },
  { question: "What will the high temperature be tomorrow?", outcomes: ["Below 30°F", "30-39°F", "40-49°F", "50°F+"] },
  { question: "Which State Street spot gets the most check-ins tonight?", outcomes: ["Coffee", "Pizza", "Boba", "Bars"] },
];

/** Pick `count` distinct templates, mixing Yes/No and multiple choice. `rand` in [0,1). */
export function pickTemplates(count: number, rand: () => number): TestTemplate[] {
  const pool = [...TEST_TEMPLATES];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}

/**
 * Close times for `count` test markets: every 30 minutes from the next :00/:30 at least 20 minutes away, ending by
 * 11:30pm Madison time. If that doesn't fit (it's late), they're spread evenly over the next 3 hours instead.
 */
export function closeTimes(now: Date, count: number): Date[] {
  const step = 30 * 60e3;
  const first = Math.ceil((now.getTime() + 20 * 60e3) / step) * step;
  const last = madisonAt(now, 23, 30).getTime();
  if (first + (count - 1) * step <= last) return Array.from({ length: count }, (_, i) => new Date(first + i * step));
  const span = Math.max(last - first, 3 * 3600e3);
  const gap = count > 1 ? span / (count - 1) : 0;
  return Array.from({ length: count }, (_, i) => new Date(Math.round((first + i * gap) / 60e3) * 60e3));
}

/** Random winner weighted by the crowd's odds (prices sum to 1). */
export function weightedPick(probs: readonly number[], r: number): number {
  let acc = 0;
  for (let i = 0; i < probs.length; i++) {
    acc += probs[i];
    if (r < acc) return i;
  }
  return probs.length - 1;
}
