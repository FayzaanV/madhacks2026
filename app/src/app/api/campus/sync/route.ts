import { handle } from "@/server/api";
import { requireUser } from "@/server/auth";
import { pollOnce } from "@/server/campus-data";
import { isAdmin, TradeError } from "@/server/markets";

/** POST /api/campus/sync (admins): save rec counts and settle due weather / rec-center markets right now. */
export async function POST() {
  return handle(async () => {
    const user = await requireUser();
    if (!isAdmin(user)) throw new TradeError("Admins only.", 403);
    return Response.json(await pollOnce());
  });
}
