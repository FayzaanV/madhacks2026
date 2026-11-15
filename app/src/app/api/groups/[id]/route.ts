import { handle } from "@/server/api";
import { requireUser } from "@/server/auth";
import { listGroupMarkets, TradeError } from "@/server/markets";
import { deleteGroup, getGroup, groupLeaderboard } from "@/server/social";

/** GET /api/groups/:id -> group, members, markets, leaderboard (members only). DELETE -> delete it (owner). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    const id = (await params).id;
    const group = await getGroup(me, id);
    if (!group) throw new TradeError("Group not found.", 404);
    const [markets, leaderboard] = await Promise.all([listGroupMarkets(id), groupLeaderboard(id)]);
    return Response.json({ group, markets, leaderboard });
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await deleteGroup(await requireUser(), (await params).id);
    return Response.json({ ok: true });
  });
}
