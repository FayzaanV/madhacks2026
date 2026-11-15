import { handle, readJson } from "@/server/api";
import { requireUser } from "@/server/auth";
import { openDispute } from "@/server/social";

/** POST /api/markets/:id/dispute { reason? } -> dispute a group market within 24h of resolution. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    const { reason } = await readJson<{ reason: string }>(req);
    return Response.json(await openDispute(me, (await params).id, reason));
  });
}
