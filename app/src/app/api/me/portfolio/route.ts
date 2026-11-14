import { handle } from "@/server/api";
import { requireUser } from "@/server/auth";
import { cloutHistory, positions, summarize, tradeHistory } from "@/server/portfolio";

/** GET /api/me/portfolio?page= -> summary, positions (open + settled), trade history page, Clout history (gold). */
export async function GET(req: Request) {
  return handle(async () => {
    const u = await requireUser();
    const page = Number(new URL(req.url).searchParams.get("page") ?? 0) || 0;
    const [pos, trades, history] = await Promise.all([positions(u.user_id), tradeHistory(u.user_id, page), cloutHistory(u.user_id)]);
    return Response.json({ summary: summarize(u.clout, pos), positions: pos, trades, history: history.points });
  });
}
