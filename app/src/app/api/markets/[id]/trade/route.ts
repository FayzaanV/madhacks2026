import { handle, readJson } from "@/server/api";
import { requireUser } from "@/server/auth";
import { placeBuy, placeSell } from "@/server/markets";

/**
 * POST /api/markets/:id/trade. Sign-in required.
 *   buy:  { outcome, amount }                  -> spends `amount` Clout, moves the LMSR price up
 *   sell: { side: "sell", outcome, shares }    -> sells shares back at the LMSR price, proceeds to your balance
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const user = await requireUser();
    const body = await readJson<{ side: "buy" | "sell"; outcome: number; amount: number; shares: number }>(req);
    const outcome = Number(body.outcome);
    return Response.json(
      body.side === "sell"
        ? await placeSell(user.user_id, id, outcome, Number(body.shares))
        : await placeBuy(user.user_id, id, outcome, Number(body.amount)),
    );
  });
}
