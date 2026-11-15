import { handle, readJson } from "@/server/api";
import { requireUser } from "@/server/auth";
import { respondInvite } from "@/server/social";

/** POST /api/groups/invites/:groupId { accept } -> join the group, or decline the invite. */
export async function POST(req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    const { accept } = await readJson<{ accept: boolean }>(req);
    return Response.json(await respondInvite(me, (await params).groupId, accept === true));
  });
}
