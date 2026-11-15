import { handle, readJson } from "@/server/api";
import { requireUser } from "@/server/auth";
import { inviteToGroup } from "@/server/social";

/** POST /api/groups/:id/invites { user_ids } -> invite friends to the group (in-app, no link). Any member. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    const { user_ids } = await readJson<{ user_ids: string[] }>(req);
    return Response.json(await inviteToGroup(me, (await params).id, user_ids));
  });
}
