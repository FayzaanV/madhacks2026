import { handle, readJson } from "@/server/api";
import { requireUser } from "@/server/auth";
import { addComment, getComments } from "@/server/markets";

/** GET /api/markets/:id/comments?before=<cursor> -> { comments (50, newest first), next cursor or null, total }. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const before = new URL(req.url).searchParams.get("before");
    return Response.json(await getComments((await params).id, before));
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
