import "server-only";
import { eligibleVoters, inviteCode, tallyVotes } from "@/core/social";
import type { Winner } from "@/core/clout";
import { q, tx } from "./ledger";
import { getVisibleMarket, settleMarket, TradeError } from "./markets";
import { notify } from "./notify";

/**
 * Friends, private groups, vetoes, group disputes and head-to-head challenges. All in the Lakebase ledger.
 * Rules: group markets are members-only; people can be tagged only in their own group's markets; a tagged member
 * can veto (market voids, everyone refunded); group results move real Clout but never count on public leaderboards.
 */

type Me = { user_id: string; handle: string };
const pair = (a: string, b: string) => (a < b ? [a, b] : [b, a]);
const MAX_REQUESTS_PER_DAY = 30;

// ------------------------------------------------------------------ friends

export type Person = { user_id: string; handle: string; avatar_v: number | null; title: string | null };
const PERSON = `u.user_id, u.handle, u.title, extract(epoch FROM u.avatar_updated_at)::int AS avatar_v`;

/** Real (non-simulated) users whose handle starts with or contains the query. */
export async function searchUsers(me: Me, query: string): Promise<(Person & { relation: string })[]> {
  const term = query.trim().replace(/^@/, "").toLowerCase();
  if (term.length < 2) return [];
  return q(
    `SELECT ${PERSON},
            CASE WHEN f.status = 'accepted' THEN 'friend' WHEN f.requested_by = $1 THEN 'sent'
                 WHEN f.status = 'pending' THEN 'received' ELSE 'none' END AS relation
     FROM users u
     LEFT JOIN friendships f ON (f.user_a = least($1, u.user_id) AND f.user_b = greatest($1, u.user_id))
     WHERE NOT u.is_simulated AND u.deleted_at IS NULL AND u.user_id <> $1 AND u.user_id NOT LIKE 'u-yomi-%'
       AND lower(u.handle) LIKE $2
     ORDER BY lower(u.handle) LIKE $3 DESC, lower(u.handle) LIMIT 12`,
    [me.user_id, `%${term}%`, `${term}%`],
  );
}

export async function sendFriendRequest(me: Me, handle: string) {
  const [other] = await q<{ user_id: string }>(
    "SELECT user_id FROM users WHERE lower(handle) = lower($1) AND NOT is_simulated AND deleted_at IS NULL",
    [handle.replace(/^@/, "").trim()],
  );
  if (!other) throw new TradeError("No one has that username.", 404);
  if (other.user_id === me.user_id) throw new TradeError("That's you.");
  const [a, b] = pair(me.user_id, other.user_id);
  return tx(async (c) => {
    const sent = (
      await c.query("SELECT count(*)::int AS n FROM friendships WHERE requested_by = $1 AND created_at > now() - interval '1 day'", [me.user_id])
    ).rows[0].n as number;
    if (sent >= MAX_REQUESTS_PER_DAY) throw new TradeError("That's a lot of requests today. Try again tomorrow.", 429);
    const existing = (await c.query("SELECT status, requested_by FROM friendships WHERE user_a = $1 AND user_b = $2 FOR UPDATE", [a, b])).rows[0];
    if (existing?.status === "accepted") throw new TradeError("You're already friends.", 409);
    if (existing && existing.requested_by !== me.user_id) {
      // They already asked you: accept instead.
      await c.query("UPDATE friendships SET status = 'accepted', responded_at = now() WHERE user_a = $1 AND user_b = $2", [a, b]);
      await notify([other.user_id], "friend_accepted", me.user_id, me.user_id, `@${me.handle} accepted your friend request.`, c);
      return { status: "accepted" };
    }
    if (existing) return { status: "pending" };
    await c.query("INSERT INTO friendships (user_a, user_b, status, requested_by) VALUES ($1, $2, 'pending', $3)", [a, b, me.user_id]);
    await notify([other.user_id], "friend_request", me.user_id, me.user_id, `@${me.handle} sent you a friend request.`, c);
    return { status: "pending" };
  });
}

/** Accept or decline a request from `otherId` (decline/unfriend/cancel all delete the row). */
export async function respondFriend(me: Me, otherId: string, accept: boolean) {
  const [a, b] = pair(me.user_id, otherId);
  if (accept) {
    const r = await q(
      `UPDATE friendships SET status = 'accepted', responded_at = now()
       WHERE user_a = $1 AND user_b = $2 AND status = 'pending' AND requested_by <> $3 RETURNING 1`,
      [a, b, me.user_id],
    );
    if (!r.length) throw new TradeError("No pending request from them.", 404);
    await notify([otherId], "friend_accepted", me.user_id, me.user_id, `@${me.handle} accepted your friend request.`);
    return { status: "accepted" };
  }
  await q("DELETE FROM friendships WHERE user_a = $1 AND user_b = $2", [a, b]);
  return { status: "none" };
}

export async function areFriends(x: string, y: string): Promise<boolean> {
  const [a, b] = pair(x, y);
  return (await q("SELECT 1 FROM friendships WHERE user_a = $1 AND user_b = $2 AND status = 'accepted'", [a, b])).length > 0;
}

export async function listFriends(me: Me) {
  const rows = await q<Person & { status: string; requested_by: string }>(
    `SELECT ${PERSON}, f.status, f.requested_by FROM friendships f
     JOIN users u ON u.user_id = CASE WHEN f.user_a = $1 THEN f.user_b ELSE f.user_a END
     WHERE (f.user_a = $1 OR f.user_b = $1) AND u.deleted_at IS NULL ORDER BY lower(u.handle)`,
    [me.user_id],
  );
  return {
    friends: rows.filter((r) => r.status === "accepted"),
    incoming: rows.filter((r) => r.status === "pending" && r.requested_by !== me.user_id),
    outgoing: rows.filter((r) => r.status === "pending" && r.requested_by === me.user_id),
  };
}

// ------------------------------------------------------------------ groups

export type Group = { group_id: string; name: string; description: string | null; owner_id: string; invite_code: string; role: string; members: number };

export async function myGroups(me: Me): Promise<Group[]> {
  return q<Group>(
    `SELECT g.group_id, g.name, g.description, g.owner_id, g.invite_code, gm.role,
            (SELECT count(*)::int FROM group_members x WHERE x.group_id = g.group_id) AS members
     FROM groups g JOIN group_members gm ON gm.group_id = g.group_id AND gm.user_id = $1
     WHERE g.deleted_at IS NULL ORDER BY g.created_at DESC`,
    [me.user_id],
  );
}

export async function createGroup(me: Me, name: unknown, description: unknown) {
  const n = String(name ?? "").trim().slice(0, 60);
  if (n.length < 2) throw new TradeError("Give the group a name (2–60 characters).");
  const owned = await q<{ n: number }>("SELECT count(*)::int AS n FROM groups WHERE owner_id = $1 AND deleted_at IS NULL", [me.user_id]);
  if (owned[0].n >= 20) throw new TradeError("You own 20 groups already.");
  const id = `g-${crypto.randomUUID()}`;
  await tx(async (c) => {
    await c.query("INSERT INTO groups (group_id, name, description, owner_id, invite_code) VALUES ($1, $2, $3, $4, $5)", [
      id,
      n,
      String(description ?? "").trim().slice(0, 280) || null,
      me.user_id,
      inviteCode(Math.random),
    ]);
    await c.query("INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')", [id, me.user_id]);
  });
  return { group_id: id };
}

/** A group with its members (members only; null otherwise). */
export async function getGroup(me: Me, groupId: string) {
  const [g] = await q<Group>(
    `SELECT g.group_id, g.name, g.description, g.owner_id, g.invite_code, gm.role,
            (SELECT count(*)::int FROM group_members x WHERE x.group_id = g.group_id) AS members
     FROM groups g JOIN group_members gm ON gm.group_id = g.group_id AND gm.user_id = $2
     WHERE g.group_id = $1 AND g.deleted_at IS NULL`,
    [groupId, me.user_id],
  );
  if (!g) return null;
  const members = await q<Person & { role: string }>(
    `SELECT ${PERSON}, gm.role FROM group_members gm JOIN users u USING (user_id) WHERE gm.group_id = $1
     ORDER BY gm.role = 'owner' DESC, gm.role = 'admin' DESC, lower(u.handle)`,
    [groupId],
  );
  return { ...g, memberList: members };
}

export async function groupByCode(code: string) {
  const [g] = await q<{ group_id: string; name: string; description: string | null; members: number }>(
    `SELECT g.group_id, g.name, g.description, (SELECT count(*)::int FROM group_members x WHERE x.group_id = g.group_id) AS members
     FROM groups g WHERE g.invite_code = $1 AND g.deleted_at IS NULL`,
    [code.trim().toLowerCase()],
  );
  return g ?? null;
}

export async function joinByCode(me: Me, code: string) {
  const g = await groupByCode(code);
  if (!g) throw new TradeError("That invite link doesn't work anymore.", 404);
  const r = await q("INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1", [g.group_id, me.user_id]);
  if (r.length) {
    const admins = await q<{ user_id: string }>("SELECT user_id FROM group_members WHERE group_id = $1 AND role IN ('owner', 'admin')", [g.group_id]);
    await notify(admins.map((a) => a.user_id), "group_joined", g.group_id, me.user_id, `@${me.handle} joined ${g.name}.`);
  }
  return { group_id: g.group_id };
}

// ------------------------------------------------------------------ in-app group invites (no link needed)

/** Any member can invite their friends; invitees get a notification and accept/decline on /groups. */
export async function inviteToGroup(me: Me, groupId: string, userIds: unknown) {
  const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).map(String))].slice(0, 50);
  const g = await getGroup(me, groupId);
  if (!g) throw new TradeError("Group not found.", 404);
  if (!ids.length) throw new TradeError("Pick at least one friend.");
  const { friends } = await listFriends(me);
  const notFriends = ids.filter((id) => !friends.some((f) => f.user_id === id));
  if (notFriends.length) throw new TradeError("You can only invite your friends.", 403);
  const fresh = await q<{ user_id: string }>(
    `INSERT INTO group_invites (group_id, user_id, invited_by)
     SELECT $1, u, $2 FROM unnest($3::text[]) AS u
     WHERE NOT EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = $1 AND m.user_id = u)
     ON CONFLICT (group_id, user_id) DO NOTHING RETURNING user_id`,
    [groupId, me.user_id, ids],
  );
  await notify(fresh.map((r) => r.user_id), "group_invite", groupId, me.user_id, `@${me.handle} invited you to ${g.name}.`);
  return { invited: fresh.length };
}

export type Invite = { group_id: string; name: string; description: string | null; members: number; invited_by: string };

export async function myInvites(me: Me): Promise<Invite[]> {
  return q<Invite>(
    `SELECT g.group_id, g.name, g.description, u.handle AS invited_by,
            (SELECT count(*)::int FROM group_members x WHERE x.group_id = g.group_id) AS members
     FROM group_invites i JOIN groups g USING (group_id) JOIN users u ON u.user_id = i.invited_by
     WHERE i.user_id = $1 AND g.deleted_at IS NULL ORDER BY i.created_at DESC`,
    [me.user_id],
  );
}

/** Accept (join) or decline an invite. */
export async function respondInvite(me: Me, groupId: string, accept: boolean) {
  return tx(async (c) => {
    const inv = (await c.query("DELETE FROM group_invites WHERE group_id = $1 AND user_id = $2 RETURNING invited_by", [groupId, me.user_id]))
      .rows[0];
    if (!inv) throw new TradeError("That invite isn't there anymore.", 404);
    if (!accept) return { status: "declined" };
    const g = (await c.query("SELECT name FROM groups WHERE group_id = $1 AND deleted_at IS NULL", [groupId])).rows[0];
    if (!g) throw new TradeError("That group was deleted.", 404);
    await c.query("INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [groupId, me.user_id]);
    await notify([inv.invited_by], "group_joined", groupId, me.user_id, `@${me.handle} joined ${g.name}.`, c);
    return { status: "joined", group_id: groupId };
  });
}

/** Friends you could invite to a group: not members yet; `invited` marks ones with a pending invite. */
export async function invitableFriends(me: Me, groupId: string) {
  return q<Person & { invited: boolean }>(
    `SELECT ${PERSON}, EXISTS (SELECT 1 FROM group_invites i WHERE i.group_id = $2 AND i.user_id = u.user_id) AS invited
     FROM friendships f
     JOIN users u ON u.user_id = CASE WHEN f.user_a = $1 THEN f.user_b ELSE f.user_a END
     WHERE (f.user_a = $1 OR f.user_b = $1) AND f.status = 'accepted' AND u.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = $2 AND m.user_id = u.user_id)
     ORDER BY lower(u.handle)`,
    [me.user_id, groupId],
  );
}

async function requireGroupAdmin(me: Me, groupId: string, ownerOnly = false) {
  const [r] = await q<{ role: string }>("SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2", [groupId, me.user_id]);
  if (!r || (ownerOnly ? r.role !== "owner" : r.role === "member")) throw new TradeError("Only the group's owner can do that.", 403);
}

export async function leaveGroup(me: Me, groupId: string) {
  const [r] = await q<{ role: string }>("SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2", [groupId, me.user_id]);
  if (!r) return;
  if (r.role === "owner") throw new TradeError("The owner can't leave. Delete the group instead.");
  await q("DELETE FROM group_members WHERE group_id = $1 AND user_id = $2", [groupId, me.user_id]);
}

export async function setMemberRole(me: Me, groupId: string, userId: string, role: unknown) {
  await requireGroupAdmin(me, groupId, true);
  if (role !== "admin" && role !== "member") throw new TradeError("Role must be admin or member.");
  await q("UPDATE group_members SET role = $3 WHERE group_id = $1 AND user_id = $2 AND role <> 'owner'", [groupId, userId, role]);
}

export async function removeMember(me: Me, groupId: string, userId: string) {
  await requireGroupAdmin(me, groupId);
  await q("DELETE FROM group_members WHERE group_id = $1 AND user_id = $2 AND role <> 'owner'", [groupId, userId]);
}

export async function regenerateInvite(me: Me, groupId: string) {
  await requireGroupAdmin(me, groupId);
  const code = inviteCode(Math.random);
  await q("UPDATE groups SET invite_code = $2 WHERE group_id = $1", [groupId, code]);
  return { invite_code: code };
}

export async function deleteGroup(me: Me, groupId: string) {
  await requireGroupAdmin(me, groupId, true);
  const open = await q<{ market_id: string }>("SELECT market_id FROM markets WHERE group_id = $1 AND status IN ('live', 'closed')", [groupId]);
  for (const m of open) await settleMarket(m.market_id, "void", "Group deleted", me.user_id);
  await q("UPDATE groups SET deleted_at = now() WHERE group_id = $1", [groupId]);
}

/** Members ranked by Clout won or lost on this group's markets (resolved: payout - net in; open: basis - net in). */
export async function groupLeaderboard(groupId: string) {
  return q<Person & { pnl: number; trades: number }>(
    `SELECT ${PERSON}, coalesce(sum(CASE
               WHEN m.status IN ('resolved', 'final', 'disputed') THEN (CASE WHEN t.outcome_index = r.winning_outcome_index THEN t.shares ELSE 0 END) - t.clout_spent
               WHEN m.status = 'voided' THEN 0
               ELSE t.basis_change - t.clout_spent END), 0)::float AS pnl,
            count(t.trade_id)::int AS trades
     FROM group_members gm JOIN users u USING (user_id)
     LEFT JOIN markets m ON m.group_id = gm.group_id
     LEFT JOIN trades t ON t.market_id = m.market_id AND t.user_id = gm.user_id
     LEFT JOIN resolutions r ON r.market_id = m.market_id
     WHERE gm.group_id = $1
     GROUP BY u.user_id, u.handle, u.title, u.avatar_updated_at
     ORDER BY pnl DESC, lower(u.handle)`,
    [groupId],
  );
}

// ------------------------------------------------------------------ group market tags, veto, disputes

export async function marketTags(marketId: string) {
  return q<Person & { vetoed: boolean }>(
    `SELECT ${PERSON}, t.vetoed_at IS NOT NULL AS vetoed FROM market_tags t JOIN users u USING (user_id) WHERE t.market_id = $1`,
    [marketId],
  );
}

/** A tagged member vetoes a group market about them: it voids and everyone is refunded. */
export async function vetoMarket(me: Me, marketId: string) {
  const [t] = await q<{ status: string; group_id: string }>(
    `SELECT m.status, m.group_id FROM market_tags t JOIN markets m USING (market_id) WHERE t.market_id = $1 AND t.user_id = $2`,
    [marketId, me.user_id],
  );
  if (!t) throw new TradeError("Only someone this market is about can veto it.", 403);
  if (!["live", "closed"].includes(t.status)) throw new TradeError("This market is already settled.", 409);
  await q("UPDATE market_tags SET vetoed_at = now() WHERE market_id = $1 AND user_id = $2", [marketId, me.user_id]);
  const out = await settleMarket(marketId, "void", `Vetoed by @${me.handle}, who it was about. Everyone was refunded.`, me.user_id);
  const members = await q<{ user_id: string }>("SELECT user_id FROM group_members WHERE group_id = $1", [t.group_id]);
  await notify(members.map((m) => m.user_id), "market_vetoed", marketId, me.user_id, `@${me.handle} vetoed a market about them; it was voided and refunded.`);
  return out;
}

export type DisputeState = {
  open: boolean;
  disputer: string | null;
  reason: string | null;
  closes_at: string | null;
  eligible: string[];
  counts: Record<string, number>;
  myVote: string | null;
  canDispute: boolean;
};

/** Dispute window, eligible voters and the current tally for a group market. */
export async function disputeState(marketId: string, userId: string | null): Promise<DisputeState | null> {
  const [m] = await q<{ group_id: string | null; status: string; creator_id: string; resolved_at: string | null }>(
    `SELECT m.group_id, m.status, m.creator_id, r.resolved_at FROM markets m LEFT JOIN resolutions r USING (market_id) WHERE m.market_id = $1`,
    [marketId],
  );
  if (!m?.group_id) return null;
  const [d] = await q<{ user_id: string; reason: string | null; closes_at: string; created_at: string }>(
    "SELECT user_id, reason, closes_at, created_at FROM disputes WHERE market_id = $1 AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 1",
    [marketId],
  );
  const recentlyResolved = m.status === "resolved" && m.resolved_at && Date.parse(m.resolved_at) > Date.now() - 86400e3;
  if (!d)
    return {
      open: false,
      disputer: null,
      reason: null,
      closes_at: null,
      eligible: [],
      counts: {},
      myVote: null,
      canDispute: Boolean(recentlyResolved && userId),
    };
  const [members, traders, tagged, votes] = await Promise.all([
    // Only people who were already members when the dispute opened, so nobody can invite friends to swing a vote.
    q<{ user_id: string }>("SELECT user_id FROM group_members WHERE group_id = $1 AND joined_at <= $2", [m.group_id, d.created_at]),
    q<{ user_id: string }>("SELECT DISTINCT user_id FROM trades WHERE market_id = $1", [marketId]),
    q<{ user_id: string }>("SELECT user_id FROM market_tags WHERE market_id = $1", [marketId]),
    q<{ user_id: string; vote: string }>("SELECT user_id, vote FROM dispute_votes WHERE market_id = $1", [marketId]),
  ]);
  const eligible = eligibleVoters(
    members.map((x) => x.user_id),
    traders.map((x) => x.user_id),
    { creator: m.creator_id, disputer: d.user_id, tagged: tagged.map((x) => x.user_id) },
  );
  return {
    open: true,
    disputer: d.user_id,
    reason: d.reason,
    closes_at: d.closes_at,
    eligible,
    counts: tallyVotes(votes.map((v) => v.vote), eligible.length, false).counts,
    myVote: votes.find((v) => v.user_id === userId)?.vote ?? null,
    canDispute: false,
  };
}

/** Any member can dispute a group market within 24h of its resolution; eligible members then vote. */
export async function openDispute(me: Me, marketId: string, reason: unknown) {
  const m = await getVisibleMarket(marketId, me.user_id);
  if (!m?.group_id) throw new TradeError("Only group markets can be disputed here.", 404);
  const st = await disputeState(marketId, me.user_id);
  if (!st?.canDispute) throw new TradeError("Disputes are open for 24 hours after a group market resolves.", 409);
  await tx(async (c) => {
    await c.query("UPDATE markets SET status = 'disputed' WHERE market_id = $1 AND status = 'resolved'", [marketId]);
    await c.query(
      `INSERT INTO disputes (dispute_id, market_id, user_id, reason, closes_at) VALUES ($1, $2, $3, $4, now() + interval '24 hours')`,
      [`d-${crypto.randomUUID()}`, marketId, me.user_id, String(reason ?? "").trim().slice(0, 500) || null],
    );
    await c.query("DELETE FROM dispute_votes WHERE market_id = $1", [marketId]);
  });
  const st2 = await disputeState(marketId, me.user_id);
  if (!st2?.eligible.length) {
    // Nobody can vote (everyone traded it, or it's tiny): the creator's result stands; the owner can still override.
    await closeDispute(marketId, true);
    return { eligible: 0, note: "No members are eligible to vote (they all traded it), so the result stands. The group owner can still override." };
  }
  const members = await q<{ user_id: string }>("SELECT user_id FROM group_members WHERE group_id = $1", [m.group_id]);
  await notify(members.map((x) => x.user_id), "dispute_opened", marketId, me.user_id, `@${me.handle} disputed "${m.question}".`);
  await notify(st2?.eligible ?? [], "vote_needed", marketId, me.user_id, `You can vote on the disputed market "${m.question}".`);
  return { eligible: st2?.eligible.length ?? 0 };
}

/** Cast or change a vote; closes the dispute as soon as a majority of eligible voters agree. */
export async function castVote(me: Me, marketId: string, vote: unknown) {
  const st = await disputeState(marketId, me.user_id);
  if (!st?.open) throw new TradeError("There's no open dispute on this market.", 409);
  if (!st.eligible.includes(me.user_id)) throw new TradeError("Only members who didn't trade this market can vote.", 403);
  const v = vote === "void" ? "void" : String(Number(vote));
  const [n] = await q<{ n: number }>("SELECT count(*)::int AS n FROM outcomes WHERE market_id = $1", [marketId]);
  if (v !== "void" && !(Number(v) >= 0 && Number(v) < n.n)) throw new TradeError("Unknown outcome.");
  await q(
    `INSERT INTO dispute_votes (market_id, user_id, vote) VALUES ($1, $2, $3)
     ON CONFLICT (market_id, user_id) DO UPDATE SET vote = EXCLUDED.vote, created_at = now()`,
    [marketId, me.user_id, v],
  );
  return closeDispute(marketId, false);
}

/**
 * Decide a dispute: majority now, or plurality once the 24h window ends (`final`). A changed outcome re-settles
 * with override (balances move by the difference); otherwise the creator's result stands. Status returns to resolved.
 */
export async function closeDispute(marketId: string, final: boolean) {
  const st = await disputeState(marketId, null);
  if (!st?.open) return { closed: false };
  const votes = await q<{ vote: string }>("SELECT vote FROM dispute_votes WHERE market_id = $1", [marketId]);
  const { decided } = tallyVotes(votes.map((v) => v.vote), st.eligible.length, final);
  if (decided === null && !final) return { closed: false };
  const [cur] = await q<{ w: number | null; status: string }>(
    "SELECT r.winning_outcome_index AS w, m.status FROM markets m JOIN resolutions r USING (market_id) WHERE m.market_id = $1",
    [marketId],
  );
  const current: Winner = cur?.w == null ? "void" : cur.w;
  if (decided !== null && decided !== current)
    await settleMarket(marketId, decided, "Changed by member vote after a dispute.", st.disputer ?? "u-yomi-union", { override: true, by: "member vote" });
  else await q("UPDATE markets SET status = 'resolved' WHERE market_id = $1 AND status = 'disputed'", [marketId]);
  await q("UPDATE disputes SET resolved_at = now() WHERE market_id = $1 AND resolved_at IS NULL", [marketId]);
  const [g] = await q<{ group_id: string }>("SELECT group_id FROM markets WHERE market_id = $1", [marketId]);
  const members = await q<{ user_id: string }>("SELECT user_id FROM group_members WHERE group_id = $1", [g.group_id]);
  await notify(
    members.map((x) => x.user_id),
    "dispute_closed",
    marketId,
    null,
    decided !== null && decided !== current ? "A dispute changed a market's result after a member vote." : "A dispute closed; the result stands.",
  );
  return { closed: true, changed: decided !== null && decided !== current };
}

/** Close disputes whose 24h window has ended (background poller). */
export async function closeExpiredDisputes() {
  const due = await q<{ market_id: string }>("SELECT DISTINCT market_id FROM disputes WHERE resolved_at IS NULL AND closes_at <= now()");
  let n = 0;
  for (const d of due) if ((await closeDispute(d.market_id, true)).closed) n++;
  return n;
}

// ------------------------------------------------------------------ head-to-head challenges

export type ChallengeRow = {
  challenge_id: string;
  market_id: string;
  question: string;
  challenger_id: string;
  challenger_handle: string;
  opponent_id: string;
  opponent_handle: string;
  challenger_label: string;
  opponent_label: string;
  stake: number;
  status: string;
  winner_id: string | null;
  created_at: string;
};

const CHALLENGE_SQL = `
  SELECT c.challenge_id, c.market_id, m.question, c.challenger_id, cu.handle AS challenger_handle, c.opponent_id,
         ou.handle AS opponent_handle, c.stake, c.status, c.winner_id, c.created_at,
         (SELECT label FROM outcomes o WHERE o.market_id = c.market_id AND o.outcome_index = c.challenger_outcome) AS challenger_label,
         coalesce((SELECT label FROM outcomes o WHERE o.market_id = c.market_id AND o.outcome_index = c.opponent_outcome), 'anything else') AS opponent_label
  FROM challenges c JOIN markets m USING (market_id) JOIN users cu ON cu.user_id = c.challenger_id JOIN users ou ON ou.user_id = c.opponent_id`;

export async function myChallenges(me: Me): Promise<ChallengeRow[]> {
  return q<ChallengeRow>(`${CHALLENGE_SQL} WHERE $1 IN (c.challenger_id, c.opponent_id) ORDER BY c.created_at DESC LIMIT 50`, [me.user_id]);
}

/** Challenge a friend on an open market: you pick your outcome and a whole-Clout stake. Nothing moves until they accept. */
export async function createChallenge(me: Me, input: { friend_id?: unknown; market_id?: unknown; outcome?: unknown; opponent_outcome?: unknown; stake?: unknown }) {
  const friendId = String(input.friend_id ?? "");
  const marketId = String(input.market_id ?? "");
  const stake = Number(input.stake);
  const outcome = Number(input.outcome);
  if (!Number.isInteger(stake) || stake < 1) throw new TradeError("Stake a whole number of Clout (1 or more).");
  if (!(await areFriends(me.user_id, friendId))) throw new TradeError("You can only challenge friends.", 403);
  const m = await getVisibleMarket(marketId, me.user_id);
  if (!m) throw new TradeError("Market not found.", 404);
  if (m.status !== "live" || m.past_close) throw new TradeError("That market isn't open anymore.");
  if (m.group_id && !(await getVisibleMarket(marketId, friendId))) throw new TradeError("Your friend isn't in this group.", 403);
  if (!m.outcomes.some((o) => o.outcome_index === outcome)) throw new TradeError("Unknown outcome.");
  const opp = input.opponent_outcome == null || input.opponent_outcome === "" ? null : Number(input.opponent_outcome);
  if (opp !== null && (opp === outcome || !m.outcomes.some((o) => o.outcome_index === opp))) throw new TradeError("Pick a different outcome for your friend.");
  const id = `ch-${crypto.randomUUID()}`;
  await q(
    `INSERT INTO challenges (challenge_id, market_id, challenger_id, opponent_id, challenger_outcome, opponent_outcome, stake)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, marketId, me.user_id, friendId, outcome, opp, stake],
  );
  const mine = m.outcomes[outcome].label;
  await notify([friendId], "challenge_received", marketId, me.user_id, `@${me.handle} bet you ${stake} Clout on "${m.question}" (they say ${mine}).`);
  return { challenge_id: id };
}

/** Accept (both stakes leave balances in one transaction), decline, or cancel (challenger, while pending). */
export async function respondChallenge(me: Me, challengeId: string, action: unknown) {
  return tx(async (c) => {
    const ch = (await c.query("SELECT * FROM challenges WHERE challenge_id = $1 FOR UPDATE", [challengeId])).rows[0];
    if (!ch || ch.status !== "pending") throw new TradeError("That challenge isn't pending anymore.", 409);
    if (action === "cancel") {
      if (ch.challenger_id !== me.user_id) throw new TradeError("Only the challenger can cancel.", 403);
      await c.query("UPDATE challenges SET status = 'cancelled' WHERE challenge_id = $1", [challengeId]);
      return { status: "cancelled" };
    }
    if (ch.opponent_id !== me.user_id) throw new TradeError("This challenge isn't for you.", 403);
    if (action !== "accept") {
      await c.query("UPDATE challenges SET status = 'declined' WHERE challenge_id = $1", [challengeId]);
      return { status: "declined" };
    }
    const m = (await c.query("SELECT status, closes_at < now() AS past FROM markets WHERE market_id = $1 FOR SHARE", [ch.market_id])).rows[0];
    if (m.status !== "live" || m.past) throw new TradeError("That market isn't open anymore.");
    const users = (await c.query("SELECT user_id, clout FROM users WHERE user_id = ANY($1) ORDER BY user_id FOR UPDATE", [[ch.challenger_id, ch.opponent_id]]))
      .rows as { user_id: string; clout: number }[];
    for (const u of users) if (u.clout < ch.stake) throw new TradeError(u.user_id === me.user_id ? "You don't have enough Clout." : "Your friend doesn't have enough Clout anymore.");
    await c.query("UPDATE users SET clout = clout - $2 WHERE user_id = ANY($1)", [[ch.challenger_id, ch.opponent_id], ch.stake]);
    await c.query("UPDATE challenges SET status = 'accepted', accepted_at = now() WHERE challenge_id = $1", [challengeId]);
    await notify([ch.challenger_id], "challenge_accepted", ch.market_id, me.user_id, `@${me.handle} accepted your ${ch.stake} Clout challenge.`, c);
    return { status: "accepted" };
  });
}

/** Challenges on a market that this user can see (their own; on group markets, the group's). */
export async function marketChallenges(marketId: string, userId: string): Promise<ChallengeRow[]> {
  return q<ChallengeRow>(
    `${CHALLENGE_SQL} WHERE c.market_id = $1 AND $2 IN (c.challenger_id, c.opponent_id) AND c.status IN ('pending', 'accepted', 'settled', 'void')
     ORDER BY c.created_at DESC`,
    [marketId, userId],
  );
}
