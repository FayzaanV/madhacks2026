import { handle, readJson } from "@/server/api";
import { requireUser } from "@/server/auth";
import { joinByCode } from "@/server/social";

/** POST /api/groups/join { code } -> join a group with its invite code. */
export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const { code } = await readJson<{ code: string }>(req);
    return Response.json(await joinByCode(me, String(code ?? "")));
  });
}
