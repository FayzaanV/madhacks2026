import "server-only";
import { activeLook, equip, ITEMS, type Look, type Slot } from "@/core/cosmetics";
import { AuthError } from "./auth";
import { openStakeSql, q } from "./ledger";
import { querySql } from "./warehouse";

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
 * Databricks touch: share of real forecasters who currently own each item, from gold.user_clout (true Clout as the
 * pipeline computes it). Empty in local mode or if gold isn't reachable; the shop just hides the stat.
 */
export async function unlockRates(): Promise<Record<string, number>> {
  const cols = ITEMS.map((it, i) => {
    const cond = it.max !== undefined ? `c.clout <= ${it.max}` : `c.clout >= ${it.min}`;
    return `avg(CASE WHEN ${cond} THEN 1.0 ELSE 0 END) AS i${i}`;
  }).join(", ");
  const rows = await querySql<Record<string, number>>(
    `SELECT ${cols} FROM {catalog}.gold.user_clout c WHERE NOT c.is_simulated`,
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
