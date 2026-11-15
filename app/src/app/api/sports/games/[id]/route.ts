import { handle } from "@/server/api";
import { TradeError } from "@/server/markets";
import { getGame } from "@/server/sports";

/** GET /api/sports/games/:eventId -> live score for one game (the market page polls this while it's live). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const g = await getGame((await params).id);
    if (!g) throw new TradeError("Game not found.", 404);
    return Response.json({ game: g });
  });
}
