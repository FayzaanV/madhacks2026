import { handle, readJson } from "@/server/api";
import { requireUser } from "@/server/auth";
import { addComment, getComments } from "@/server/markets";

/** GET /api/markets/:id/comments -> latest comments. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => Response.json({ comments: await getComments((await params).id) }));
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
