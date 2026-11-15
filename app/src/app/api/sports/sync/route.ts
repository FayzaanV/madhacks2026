import { handle } from "@/server/api";
import { requireUser } from "@/server/auth";
import { isAdmin, TradeError } from "@/server/markets";
import { tick } from "@/server/pollers";

/** POST /api/sports/sync -> run one poller tick now (admins). Normally it runs every minute on its own. */
export async function POST() {
  return handle(async () => {
    const u = await requireUser();
    if (!isAdmin(u)) throw new TradeError("Admins only.", 403);
    return Response.json({ result: await tick() });
  });
}
