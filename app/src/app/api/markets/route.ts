import { connection } from "next/server";
import { handle, readJson } from "@/server/api";
import { requireUser } from "@/server/auth";
import { createMarket, listMarkets, type NewMarket } from "@/server/markets";

/** GET /api/markets?status=live&q=econ -> markets with live LMSR prices from Lakebase. */
export async function GET(req: Request) {
  return handle(async () => {
    await connection(); // per-request data; never prerender
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const status = url.searchParams.get("status") ?? "live";
    const markets = (await listMarkets(status)).filter((m) => !q || `${m.question} ${m.course}`.toLowerCase().includes(q));
    return Response.json({ markets });
  });
}

/**
 * POST /api/markets { question, course, market_type, outcomes?, closes_at, resolution_source?, liquidity_b?,
 * not_about_a_student } -> { marketId }. Admins only for now (ADMIN_EMAILS).
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    return Response.json(await createMarket(user, await readJson<NewMarket>(req)), { status: 201 });
  });
}
