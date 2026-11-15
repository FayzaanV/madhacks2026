import { handle } from "@/server/api";
import { requireUser } from "@/server/auth";
import { regenerateInvite } from "@/server/social";

/** POST /api/groups/:id/invite -> new invite code (old links stop working). Owner/admins. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => Response.json(await regenerateInvite(await requireUser(), (await params).id)));
}
