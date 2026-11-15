// Friends, groups and challenges: pure rules (tested in social.test.ts). Server code in server/social.ts.
import type { Winner } from "./clout";

/** @handles mentioned in text (lowercased, unique). Handles are 3-20 chars of [a-z0-9_]. */
export function parseMentions(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(^|[^a-z0-9_@])@([a-z0-9_]{3,20})(?![a-z0-9_])/gi)) out.add(m[2].toLowerCase());
  return [...out];
}

/** Who may vote on a disputed group market: members who didn't trade it, minus its creator, the disputer and anyone tagged. */
export function eligibleVoters(
  members: readonly string[],
  traders: readonly string[],
  exclude: { creator: string; disputer: string; tagged: readonly string[] },
): string[] {
  const no = new Set([...traders, exclude.creator, exclude.disputer, ...exclude.tagged]);
  return members.filter((m) => !no.has(m));
}

export type Tally = { decided: Winner | null; counts: Record<string, number> };

/**
 * Votes are outcome indexes as strings, or "void". A strict majority of all eligible voters decides immediately.
 * When the voting window has ended (`final`), the plurality wins; a tie or no votes decides nothing (the creator's
 * resolution stands).
 */
export function tallyVotes(votes: readonly string[], eligible: number, final: boolean): Tally {
  const counts: Record<string, number> = {};
  for (const v of votes) counts[v] = (counts[v] ?? 0) + 1;
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const toWinner = (k: string): Winner => (k === "void" ? "void" : Number(k));
  if (ranked[0] && ranked[0][1] > eligible / 2) return { decided: toWinner(ranked[0][0]), counts };
  if (final && ranked[0] && (!ranked[1] || ranked[0][1] > ranked[1][1])) return { decided: toWinner(ranked[0][0]), counts };
  return { decided: null, counts };
}

export type Challenge = {
  challenger_id: string;
  opponent_id: string;
  challenger_outcome: number;
  opponent_outcome: number | null; // null = "anything else"
  stake: number;
};

/**
 * Credits when an accepted challenge settles (both stakes were already taken from balances on accept).
 * The side holding the winning outcome gets 2x stake; if neither side's outcome won (multiple choice) or the market
 * was voided, both get their stake back. Returns { userId: credit } and the winner (or null).
 */
export function challengeCredits(c: Challenge, winner: Winner): { credits: Record<string, number>; winnerId: string | null } {
  const refund = { credits: { [c.challenger_id]: c.stake, [c.opponent_id]: c.stake }, winnerId: null };
  if (winner === "void") return refund;
  if (winner === c.challenger_outcome) return { credits: { [c.challenger_id]: 2 * c.stake }, winnerId: c.challenger_id };
  if (c.opponent_outcome === null || winner === c.opponent_outcome)
    return { credits: { [c.opponent_id]: 2 * c.stake }, winnerId: c.opponent_id };
  return refund;
}

/** Re-settling a challenge after an override: balances move by (new credits - old credits). */
export function challengeDeltas(c: Challenge, from: Winner, to: Winner): Record<string, number> {
  const a = challengeCredits(c, from).credits;
  const b = challengeCredits(c, to).credits;
  const out: Record<string, number> = {};
  for (const u of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const d = (b[u] ?? 0) - (a[u] ?? 0);
    if (d !== 0) out[u] = d;
  }
  return out;
}

/** Random, unambiguous invite code (no 0/O/1/l). */
export function inviteCode(rand: () => number, n = 10): string {
  const abc = "abcdefghijkmnpqrstuvwxyz23456789";
  return Array.from({ length: n }, () => abc[Math.floor(rand() * abc.length)]).join("");
}
