import { handle } from "@/server/api";
import { AuthError, requireUser } from "@/server/auth";
import { isAdmin } from "@/server/markets";
import { settleDueTestMarkets } from "@/server/testmarkets";

/** POST /api/admin/test-markets/settle -> resolve every closed test market now (random, weighted by odds). Admins only. */
export async function POST() {
  return handle(async () => {
    const user = await requireUser();
    if (!isAdmin(user)) throw new AuthError("Only admins can settle test markets.", 403);
    return Response.json(await settleDueTestMarkets());
  });
}
