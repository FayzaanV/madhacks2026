import { handle, readJson } from "@/server/api";
import { requireUser } from "@/server/auth";
import { disputeScore } from "@/server/intramurals";

/** POST /api/intramurals/games/:id/dispute { note } -> the other captain disputes; an admin decides. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const u = await requireUser();
    const { note } = await readJson<{ note: string }>(req);
    return Response.json(await disputeScore(u.user_id, (await params).id, note));
  });
}
