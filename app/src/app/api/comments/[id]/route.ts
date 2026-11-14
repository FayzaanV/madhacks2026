import { handle } from "@/server/api";
import { requireUser } from "@/server/auth";
import { deleteComment } from "@/server/markets";

/** DELETE /api/comments/:id -> delete your own comment. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    await deleteComment(user.user_id, (await params).id);
    return Response.json({ ok: true });
  });
}
