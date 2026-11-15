import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { Avatar, PersonLine } from "@/components/avatar";
import { Clout } from "@/components/clout";
import { GroupMarketForm, InviteFriends, InviteLink, LeaveOrDelete, MemberActions } from "@/components/group-tools";
import { fmtDateTime } from "@/core/time";
import { listGroupMarkets } from "@/server/markets";
import { getGroup, groupLeaderboard, invitableFriends } from "@/server/social";
import { currentUser } from "@/server/user";

export default function GroupPage({ params }: PageProps<"/groups/[id]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl border border-line bg-panel" />}>
      <Group params={params} />
    </Suspense>
  );
}

async function Group({ params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const { id } = await params;
  const group = await getGroup(me, id);
  if (!group) notFound(); // not a member (or no such group)
  const [markets, board, toInvite] = await Promise.all([listGroupMarkets(id), groupLeaderboard(id), invitableFriends(me, id)]);
  const canManage = group.role !== "member";
  const open = markets.filter((m) => m.status === "live" && !m.past_close);
  const rest = markets.filter((m) => !(m.status === "live" && !m.past_close));

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="min-w-0 space-y-5">
        <header>
          <p className="text-sm text-muted">Private group · {group.members} member{group.members === 1 ? "" : "s"}</p>
          <h1 className="text-3xl font-bold">{group.name}</h1>
          {group.description && <p className="mt-1 text-muted">{group.description}</p>}
          <p className="mt-3 text-xs text-muted">Invite friends directly from the panel on the right, or share a link:</p>
          <div className="mt-1">
            <InviteLink groupId={id} code={group.invite_code} canManage={canManage} />
          </div>
        </header>

        <section className="rounded-2xl border border-line bg-panel p-4">
          <h2 className="font-semibold">Open markets <span className="text-sm font-normal text-muted">{open.length}</span></h2>
          {open.length ? (
            <ul className="mt-2 divide-y divide-line">
              {open.map((m) => (
                <li key={m.market_id}>
                  <Link href={`/markets/${m.market_id}`} className="flex items-center gap-3 py-2.5 hover:text-accent">
                    <span className="flex-1">{m.question}</span>
                    <span className="tabular text-xs text-muted">closes {fmtDateTime(m.closes_at)}</span>
                    <span className="tabular w-12 text-right font-bold">{Math.round(m.outcomes[0].price * 100)}%</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">No open markets. Make the first one →</p>
          )}
        </section>

        {rest.length > 0 && (
          <section className="rounded-2xl border border-line bg-panel p-4">
            <h2 className="font-semibold">Closed &amp; settled</h2>
            <ul className="mt-2 divide-y divide-line text-sm">
              {rest.map((m) => (
                <li key={m.market_id}>
                  <Link href={`/markets/${m.market_id}`} className="flex items-center gap-3 py-2 hover:text-accent">
                    <span className="flex-1">{m.question}</span>
                    <span className="text-xs text-muted">
                      {m.winning_outcome_index != null
                        ? `${m.outcomes[m.winning_outcome_index]?.label} won`
                        : m.past_close && m.status === "live"
                          ? "awaiting result"
                          : m.status.charAt(0).toUpperCase() + m.status.slice(1)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="rounded-2xl border border-line bg-panel p-4">
          <h2 className="font-semibold">Group leaderboard</h2>
          <p className="text-xs text-muted">Clout won or lost on this group&apos;s markets. It doesn&apos;t count on public leaderboards.</p>
          <ol className="mt-2 divide-y divide-line text-sm">
            {board.map((r, i) => (
              <li key={r.user_id} className="flex items-center gap-3 py-2">
                <span className="tabular w-5 text-muted">{i + 1}</span>
                <Avatar userId={r.user_id} handle={r.handle} v={r.avatar_v} size={24} />
                <PersonLine handle={r.handle} title={r.title} />
                <span className="ml-auto"><Clout value={r.pnl} className="text-sm" /></span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-28 lg:self-start">
        <InviteFriends groupId={id} friends={toInvite.map((f) => ({ user_id: f.user_id, handle: f.handle, invited: f.invited }))} />
        <GroupMarketForm groupId={id} members={group.memberList.map((m) => ({ user_id: m.user_id, handle: m.handle }))} />
        <section className="rounded-2xl border border-line bg-panel p-4 text-sm">
          <h2 className="font-semibold">Members</h2>
          <ul className="mt-2 space-y-2">
            {group.memberList.map((m) => (
              <li key={m.user_id} className="flex items-center gap-2">
                <Avatar userId={m.user_id} handle={m.handle} v={m.avatar_v} size={24} />
                <PersonLine handle={m.handle} title={m.role !== "member" ? m.role : null} />
                <span className="ml-auto">
                  {m.user_id !== me.user_id && <MemberActions groupId={id} userId={m.user_id} role={m.role} myRole={group.role} />}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 border-t border-line pt-2">
            <LeaveOrDelete groupId={id} isOwner={group.role === "owner"} />
          </div>
        </section>
      </aside>
    </div>
  );
}
