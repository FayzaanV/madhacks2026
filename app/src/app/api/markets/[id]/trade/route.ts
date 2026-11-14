import { handle, readJson } from "@/server/api";
import { requireUser } from "@/server/auth";
import { placeTrade } from "@/server/markets";

/** POST /api/markets/:id/trade { outcome, amount } -> spends Clout, moves the LMSR price. Sign-in required. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const user = await requireUser();
    const { outcome, amount } = await readJson<{ outcome: number; amount: number }>(req);
    return Response.json(await placeTrade(user.user_id, id, Number(outcome), Number(amount)));
  });
}
