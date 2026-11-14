import { cookies } from "next/headers";
import { handle } from "@/server/api";
import { SESSION_COOKIE, currentUser, logout } from "@/server/auth";

/** GET /api/auth/session -> { user } (null when signed out). */
export async function GET() {
  return handle(async () => {
    const u = await currentUser();
    return Response.json({
      user: u && { user_id: u.user_id, handle: u.handle, email: u.email, available: u.clout, clout: u.clout + u.open_stake },
    });
  });
}

/** DELETE /api/auth/session -> sign out (revokes the session in Lakebase). */
export async function DELETE() {
  return handle(async () => {
    await logout();
    (await cookies()).delete(SESSION_COOKIE);
    return Response.json({ ok: true });
  });
}
