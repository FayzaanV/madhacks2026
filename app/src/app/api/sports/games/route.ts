import { connection } from "next/server";
import { handle } from "@/server/api";
import { listGames } from "@/server/sports";

/** GET /api/sports/games?sport=football&school=uw-madison&days=7 -> recent, live and upcoming Big Ten games. */
export async function GET(req: Request) {
  return handle(async () => {
    await connection();
    const u = new URL(req.url).searchParams;
    const games = await listGames({ sport: u.get("sport") ?? undefined, school: u.get("school") ?? undefined, days: Number(u.get("days") ?? 7) || 7 });
    return Response.json({ games });
  });
}
