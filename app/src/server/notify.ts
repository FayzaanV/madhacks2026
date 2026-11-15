import "server-only";
import type { PoolClient } from "pg";
import { q } from "./ledger";

/**
 * In-app notifications (header bell). kinds: friend_request, friend_accepted, group_joined, tagged, mentioned,
 * market_vetoed, dispute_opened, vote_needed, dispute_closed, challenge_received, challenge_accepted, challenge_result.
 * `ref_id` points at the thing to open (market id, group id, or user id for friend notifications).
 */
export type NotificationKind =
  | "friend_request"
  | "friend_accepted"
  | "group_joined"
  | "tagged"
  | "mentioned"
  | "market_vetoed"
  | "dispute_opened"
  | "vote_needed"
  | "dispute_closed"
  | "challenge_received"
  | "challenge_accepted"
  | "challenge_result";

/** Notify several users at once (skips the actor). Pass a transaction client to notify inside one. */
export async function notify(
  userIds: readonly string[],
  kind: NotificationKind,
  refId: string | null,
  actorId: string | null,
  body: string,
  c?: PoolClient,
) {
  const to = [...new Set(userIds)].filter((u) => u && u !== actorId);
  if (!to.length) return;
  const sql = `INSERT INTO notifications (id, user_id, kind, ref_id, actor_id, body)
               SELECT 'n-' || gen_random_uuid(), u, $2, $3, $4, $5 FROM unnest($1::text[]) AS u`;
  const args = [to, kind, refId, actorId, body.slice(0, 300)];
  if (c) await c.query(sql, args);
  else await q(sql, args);
}

export type Notification = {
  id: string;
  kind: NotificationKind;
  ref_id: string | null;
  body: string;
  created_at: string;
  read: boolean;
  actor_handle: string | null;
};

export async function listNotifications(userId: string): Promise<{ items: Notification[]; unread: number }> {
  const [items, [n]] = await Promise.all([
    q<Notification>(
      `SELECT n.id, n.kind, n.ref_id, n.body, n.created_at, n.read_at IS NOT NULL AS read, a.handle AS actor_handle
       FROM notifications n LEFT JOIN users a ON a.user_id = n.actor_id
       WHERE n.user_id = $1 ORDER BY n.created_at DESC LIMIT 30`,
      [userId],
    ),
    q<{ n: number }>("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL", [userId]),
  ]);
  return { items, unread: n.n };
}

export async function markAllRead(userId: string) {
  await q("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL", [userId]);
}
