import { handle, readJson } from "@/server/api";
import { requireUser } from "@/server/auth";
import { castVote } from "@/server/social";

/** POST /api/markets/:id/vote { vote: outcomeIndex | "void" } -> eligible members vote on a disputed group market. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    const { vote } = await readJson<{ vote: number | "void" }>(req);
    return Response.json(await castVote(me, (await params).id, vote));
  });
}
