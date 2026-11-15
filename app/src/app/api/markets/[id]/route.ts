import { handle } from "@/server/api";
import { getInsight } from "@/server/analyst";
import { getVisibleMarket, smartMoney, TradeError } from "@/server/markets";
import { currentUser } from "@/server/user";

/** GET /api/markets/:id -> market + outcomes (Lakebase), Smart Money and AI insight (gold). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const market = await getVisibleMarket(id, (await currentUser())?.user_id);
    if (!market) throw new TradeError("Market not found.", 404);
    const [smart_money, ai_insight] = await Promise.all([smartMoney(id).catch(() => []), getInsight(id)]);
    return Response.json({ market, smart_money, ai_insight });
  });
}
