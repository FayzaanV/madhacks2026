import "server-only";
import { activeLook, equip, ITEMS, type Look, type Slot } from "@/core/cosmetics";
import { AuthError } from "./auth";
import { openStakeSql, q } from "./ledger";

/**
 * Shop cosmetics. users.cosmetics stores what you picked per slot; what actually shows is worked out from your true
 * Clout every time (core/cosmetics.ts), so items vanish below their threshold and come back above it on their own.
 */

/** Add to a SELECT over `users u` to get what `withLook` needs. */
export const LOOK_SQL = `u.cosmetics, u.clout + ${openStakeSql("u.user_id")} AS true_clout`;
/** Columns to add to a GROUP BY that includes LOOK_SQL. */
export const LOOK_GROUP_BY = "u.cosmetics, u.clout";

export type LookRow = { cosmetics?: string | null; true_clout?: number | null };

/** Swap the raw columns for the look to show (only items still owned at this Clout). */
export function withLook<T extends LookRow>(row: T): Omit<T, "cosmetics" | "true_clout"> & { look: Look } {
  const { cosmetics, true_clout, ...rest } = row;
  return { ...rest, look: activeLook(cosmetics, Number(true_clout ?? 0)) };
}

/** Looks for a list of users (for pages whose rows come from gold, like the leaderboard). */
export async function looksFor(userIds: string[]): Promise<Map<string, Look>> {
  if (!userIds.length) return new Map();
  const rows = await q<{ user_id: string } & LookRow>(
    `SELECT u.user_id, ${LOOK_SQL} FROM users u WHERE u.user_id = ANY($1) AND u.cosmetics IS NOT NULL`,
    [userIds],
  ).catch(() => []);
  return new Map(rows.map((r) => [r.user_id, withLook(r).look]));
}

/** Equip (or clear with null) one slot. Ownership is checked against your true Clout right now. */
export async function equipItem(
  user: { user_id: string; clout: number; open_stake: number },
  slot: Slot,
  itemId: string | null,
): Promise<Look> {
  const cur = await q<{ cosmetics: string | null }>("SELECT cosmetics FROM users WHERE user_id = $1", [user.user_id]);
  const clout = user.clout + user.open_stake;
  let next;
  try {
    next = equip(cur[0]?.cosmetics, slot, itemId, clout);
  } catch (e) {
    throw new AuthError((e as Error).message, 403);
  }
  const json = Object.keys(next).length ? JSON.stringify(next) : null;
  await q("UPDATE users SET cosmetics = $2 WHERE user_id = $1", [user.user_id, json]);
  return activeLook(json, clout);
}

/**
 * Share of real forecasters (1+ trade) who currently own each item, from true Clout in the Lakebase ledger. Plain SQL
 * on the ledger rather than gold, so the shop never wakes the SQL warehouse (same reasoning as server/leaderboard.ts).
 */
export async function unlockRates(): Promise<Record<string, number>> {
  const cols = ITEMS.map((it, i) => {
    const cond = it.max !== undefined ? `c <= ${it.max}` : `c >= ${it.min}`;
    return `avg(CASE WHEN ${cond} THEN 1.0 ELSE 0 END)::float AS i${i}`;
  }).join(", ");
  const rows = await q<Record<string, number | null>>(
    `SELECT ${cols} FROM (
       SELECT u.clout + ${openStakeSql("u.user_id")} AS c FROM users u
       WHERE NOT u.is_simulated AND u.deleted_at IS NULL AND EXISTS (SELECT 1 FROM trades t WHERE t.user_id = u.user_id)) x`,
  ).catch(() => []);
  const r = rows[0];
  if (!r) return {};
  const out: Record<string, number> = {};
  ITEMS.forEach((it, i) => {
    const v = r[`i${i}`];
    if (v !== null && v !== undefined) out[it.id] = Number(v);
  });
  return out;
}
