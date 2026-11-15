import { handle, readJson } from "@/server/api";
import { requireUser } from "@/server/auth";
import { importGames } from "@/server/intramurals";

/** POST /api/intramurals/leagues/:id/import { csv } -> games (+ teams, + winner markets) from a FusionPlay schedule. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const u = await requireUser();
    const { csv } = await readJson<{ csv: string }>(req);
    return Response.json(await importGames(u, (await params).id, String(csv ?? "")));
  });
}
