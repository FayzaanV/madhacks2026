import { handle } from "@/server/api";
import { AuthError, requireUser } from "@/server/auth";
import { isAdmin } from "@/server/markets";
import { revokePartner } from "@/server/union";

/** DELETE /api/partners/:id -> revoke that partner's API key. Admins only. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    if (!isAdmin(user)) throw new AuthError("Only admins can revoke partner keys.", 403);
    await revokePartner((await params).id);
    return Response.json({ ok: true });
  });
}
