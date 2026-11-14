import { placeTrade, TradeError } from "@/server/markets";
import { currentUser } from "@/server/user";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { outcome, amount } = (await req.json()) as { outcome: number; amount: number };
  const user = await currentUser();
  try {
    return Response.json(await placeTrade(user.user_id, id, Number(outcome), Number(amount)));
  } catch (e) {
    if (e instanceof TradeError) return Response.json({ error: e.message }, { status: 400 });
    console.error(e);
    return Response.json({ error: "Trade failed. Try again." }, { status: 500 });
  }
}
