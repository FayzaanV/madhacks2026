import { handle } from "@/server/api";
import { requireUser } from "@/server/auth";
import { myInvites } from "@/server/social";

/** GET /api/groups/invites -> group invites waiting for you. */
export async function GET() {
  return handle(async () => Response.json({ invites: await myInvites(await requireUser()) }));
}
