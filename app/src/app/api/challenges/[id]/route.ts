import { handle, readJson } from "@/server/api";
import { requireUser } from "@/server/auth";
import { respondChallenge } from "@/server/social";

/** POST /api/challenges/:id { action: "accept" | "decline" | "cancel" } */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    const { action } = await readJson<{ action: string }>(req);
    return Response.json(await respondChallenge(me, (await params).id, action));
  });
}
