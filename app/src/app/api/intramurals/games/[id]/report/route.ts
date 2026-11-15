import { handle, readJson } from "@/server/api";
import { requireUser } from "@/server/auth";
import { reportScore } from "@/server/intramurals";

/** POST /api/intramurals/games/:id/report { home, away } -> a captain reports the final score. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const u = await requireUser();
    const { home, away } = await readJson<{ home: number; away: number }>(req);
    return Response.json(await reportScore(u.user_id, (await params).id, home, away));
  });
}
