import { handle, readJson } from "@/server/api";
import { AuthError, requireUser } from "@/server/auth";
import { isAdmin } from "@/server/markets";
import { createPartner } from "@/server/union";

/** POST /api/partners { name, venue_ids } -> { partner_id, api_key } (key shown once). Admins only. */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    if (!isAdmin(user)) throw new AuthError("Only admins can create partner keys.", 403);
    const { name, venue_ids } = await readJson<{ name: string; venue_ids: string[] }>(req);
    return Response.json(await createPartner(name, venue_ids), { status: 201 });
  });
}
