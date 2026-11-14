import { addComment, TradeError } from "@/server/markets";
import { currentUser } from "@/server/user";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { body } = (await req.json()) as { body?: string };
  const user = await currentUser();
  try {
    await addComment(user.user_id, id, body ?? "");
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof TradeError) return Response.json({ error: e.message }, { status: 400 });
    console.error(e);
    return Response.json({ error: "Could not post comment." }, { status: 500 });
  }
}
