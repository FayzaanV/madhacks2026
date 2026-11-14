import { connection } from "next/server";
import { handle } from "@/server/api";
import { listMarkets } from "@/server/markets";

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
