import { handle, readJson } from "@/server/api";
import { requireUser } from "@/server/auth";
import { adminResult } from "@/server/intramurals";

/** POST /api/intramurals/games/:id/result { home, away } | { forfeit: "home"|"away" } | { canceled: true } (admins). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const u = await requireUser();
    return Response.json(await adminResult(u, (await params).id, await readJson(req)));
  });
}
