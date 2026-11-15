import { handle } from "@/server/api";
import { AuthError, requireUser } from "@/server/auth";
import { isAdmin } from "@/server/markets";
import { seedMarkets } from "@/server/seed-markets";

/** POST /api/admin/seed-markets -> add the hand-written UW–Madison demo markets (idempotent). Admins only. */
export async function POST() {
  return handle(async () => {
    const user = await requireUser();
    if (!isAdmin(user)) throw new AuthError("Admins only.", 403);
    return Response.json(await seedMarkets(user.user_id));
  });
}
