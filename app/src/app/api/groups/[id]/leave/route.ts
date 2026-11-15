import { handle } from "@/server/api";
import { requireUser } from "@/server/auth";
import { leaveGroup } from "@/server/social";

/** POST /api/groups/:id/leave */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await leaveGroup(await requireUser(), (await params).id);
    return Response.json({ ok: true });
  });
}
