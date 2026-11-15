import { handle, readJson } from "@/server/api";
import { requireUser } from "@/server/auth";
import { addComment, getComments, getVisibleMarket, TradeError } from "@/server/markets";
import { currentUser } from "@/server/user";

/** GET /api/markets/:id/comments?before=<cursor> -> { comments (50, newest first), next cursor or null, total }. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const before = new URL(req.url).searchParams.get("before");
    const id = (await params).id;
    if (!(await getVisibleMarket(id, (await currentUser())?.user_id))) throw new TradeError("Market not found.", 404);
    return Response.json(await getComments(id, before));
  });
}

/** POST /api/markets/:id/comments { body } -> add a comment. Sign-in required. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const user = await requireUser();
    const { body } = await readJson<{ body: string }>(req);
    return Response.json(await addComment(user.user_id, id, body ?? ""));
  });
}
