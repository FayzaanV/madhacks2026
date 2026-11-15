import { handle, readJson } from "@/server/api";
import { requireUser } from "@/server/auth";
import { createGroup, myGroups } from "@/server/social";

/** GET /api/groups -> your groups. POST { name, description? } -> create one (you're the owner). */
export async function GET() {
  return handle(async () => Response.json({ groups: await myGroups(await requireUser()) }));
}

export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const { name, description } = await readJson<{ name: string; description: string }>(req);
    return Response.json(await createGroup(me, name, description), { status: 201 });
  });
}
