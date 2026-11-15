import { handle } from "@/server/api";
import { requireUser } from "@/server/auth";
import { confirmScore } from "@/server/intramurals";

/** POST /api/intramurals/games/:id/confirm -> the other captain confirms; the market resolves. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const u = await requireUser();
    return Response.json(await confirmScore(u.user_id, (await params).id));
  });
}
