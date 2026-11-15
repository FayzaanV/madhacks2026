import { handle, readJson } from "@/server/api";
import { requireUser } from "@/server/auth";
import { createLeague, listLeagues } from "@/server/intramurals";

/** GET /api/intramurals/leagues -> all leagues (public). */
export async function GET() {
  return handle(async () => Response.json({ leagues: await listLeagues() }));
}

/** POST /api/intramurals/leagues { sport, season, division? } -> new league (admins). */
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser();
    return Response.json(await createLeague(u, await readJson(req)));
  });
}
