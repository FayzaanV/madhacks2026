import { handle } from "@/server/api";
import { requireUser } from "@/server/auth";
import { searchUsers } from "@/server/social";

/** GET /api/users/search?q=handle -> real users matching, with your relation to each (friend/sent/received/none). */
export async function GET(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    return Response.json({ users: await searchUsers(me, new URL(req.url).searchParams.get("q") ?? "") });
  });
}
