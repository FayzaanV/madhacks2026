import { handle, readJson } from "@/server/api";
import { requireUser } from "@/server/auth";
import { listFriends, myChallenges, sendFriendRequest } from "@/server/social";

/** GET /api/friends -> { friends, incoming, outgoing, challenges } */
export async function GET() {
  return handle(async () => {
    const me = await requireUser();
    const [lists, challenges] = await Promise.all([listFriends(me), myChallenges(me)]);
    return Response.json({ ...lists, challenges });
  });
}

/** POST /api/friends { handle } -> send a friend request (or accept theirs if they already asked). */
export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const { handle: h } = await readJson<{ handle: string }>(req);
    return Response.json(await sendFriendRequest(me, String(h ?? "")));
  });
}
