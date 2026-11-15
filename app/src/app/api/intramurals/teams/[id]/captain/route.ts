import { handle, readJson } from "@/server/api";
import { requireUser } from "@/server/auth";
import { setCaptain } from "@/server/intramurals";

/** POST /api/intramurals/teams/:id/captain { email } -> assign the captain (admins). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const u = await requireUser();
    const { email } = await readJson<{ email: string }>(req);
    return Response.json(await setCaptain(u, (await params).id, String(email ?? "")));
  });
}
