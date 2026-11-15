import { handle, readJson } from "@/server/api";
import { requireUser } from "@/server/auth";
import { createChallenge } from "@/server/social";

/** POST /api/challenges { friend_id, market_id, outcome, opponent_outcome?, stake } -> challenge a friend. */
export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    return Response.json(await createChallenge(me, await readJson(req)), { status: 201 });
  });
}
