import { handle, readJson } from "@/server/api";
import { requireUser } from "@/server/auth";
import { respondFriend } from "@/server/social";

/** PATCH /api/friends/:userId { accept: true } -> accept their request; { accept: false } -> decline. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    const { accept } = await readJson<{ accept: boolean }>(req);
    return Response.json(await respondFriend(me, (await params).id, accept === true));
  });
}

/** DELETE /api/friends/:userId -> unfriend, or cancel/decline a pending request. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => Response.json(await respondFriend(await requireUser(), (await params).id, false)));
}
