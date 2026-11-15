import { handle } from "@/server/api";
import { requireUser } from "@/server/auth";
import { vetoMarket } from "@/server/social";

/** POST /api/markets/:id/veto -> a member this group market is about vetoes it (voided, everyone refunded). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => Response.json(await vetoMarket(await requireUser(), (await params).id)));
}
