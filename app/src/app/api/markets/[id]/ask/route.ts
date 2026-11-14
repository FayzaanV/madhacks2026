import { askAnalyst } from "@/server/analyst";
import { currentUser } from "@/server/user";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { question } = (await req.json()) as { question?: string };
  if (!question?.trim()) return Response.json({ error: "Ask a question first." }, { status: 400 });
  const user = await currentUser();
  try {
    const stream = await askAnalyst(id, user.user_id, question.trim());
    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "The AI analyst is unavailable right now." }, { status: 502 });
  }
}
