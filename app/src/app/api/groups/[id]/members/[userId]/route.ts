import { handle, readJson } from "@/server/api";
import { requireUser } from "@/server/auth";
import { removeMember, setMemberRole } from "@/server/social";

/** PATCH { role: "admin" | "member" } (owner) / DELETE (owner or admin) a group member. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
  return handle(async () => {
    const { id, userId } = await params;
    const { role } = await readJson<{ role: string }>(req);
    await setMemberRole(await requireUser(), id, userId, role);
    return Response.json({ ok: true });
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
  return handle(async () => {
    const { id, userId } = await params;
    await removeMember(await requireUser(), id, userId);
    return Response.json({ ok: true });
  });
}
