import { handle } from "@/server/api";
import { AuthError, requireUser } from "@/server/auth";
import { clearAvatar, MAX_AVATAR_BYTES, setAvatar } from "@/server/profile";

/** PUT /api/me/avatar (raw image body, Content-Type image/webp|png|jpeg, <= 64 KB) -> { avatar_v }. */
export async function PUT(req: Request) {
  return handle(async () => {
    const u = await requireUser();
    const type = (req.headers.get("content-type") ?? "").split(";")[0].trim();
    if (Number(req.headers.get("content-length") ?? 0) > MAX_AVATAR_BYTES) throw new AuthError("That image is too big (64 KB max).", 413);
    const bytes = Buffer.from(await req.arrayBuffer());
    return Response.json({ avatar_v: await setAvatar(u.user_id, type, bytes) });
  });
}

/** DELETE /api/me/avatar -> back to the generated initials avatar. */
export async function DELETE() {
  return handle(async () => {
    const u = await requireUser();
    await clearAvatar(u.user_id);
    return Response.json({ ok: true });
  });
}
