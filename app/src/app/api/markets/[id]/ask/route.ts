import { handle, readJson } from "@/server/api";
import { askAnalyst } from "@/server/analyst";
import { requireUser } from "@/server/auth";
import { TradeError } from "@/server/markets";

/** POST /api/markets/:id/ask { question } -> streams the AI analyst's answer. Sign-in required. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const user = await requireUser();
    const { question } = await readJson<{ question: string }>(req);
    if (!question?.trim()) throw new TradeError("Ask a question first.");
    const stream = await askAnalyst(id, user.user_id, question.trim());
    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  });
}
