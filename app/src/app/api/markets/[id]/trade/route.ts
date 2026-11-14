import { handle, readJson } from "@/server/api";
import { requireUser } from "@/server/auth";
import { placeBuy, placeSell } from "@/server/markets";

/**
 * POST /api/markets/:id/trade. Sign-in required.
 *   buy:  { outcome, amount }                    -> spends `amount` whole Clout, moves the LMSR price up
 *   sell: { side: "sell", outcome, clout }       -> sells enough shares to receive exactly `clout` whole Clout
 *   sell: { side: "sell", outcome, all: true }   -> sells your whole position (proceeds may be fractional)
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const user = await requireUser();
    const body = await readJson<{ side: "buy" | "sell"; outcome: number; amount: number; clout: number; all: boolean }>(req);
    const outcome = Number(body.outcome);
    return Response.json(
      body.side === "sell"
        ? await placeSell(user.user_id, id, outcome, body.all ? "all" : Number(body.clout))
        : await placeBuy(user.user_id, id, outcome, Number(body.amount)),
    );
  });
}
