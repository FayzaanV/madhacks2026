import { handle, readJson } from "@/server/api";
import { requireUser } from "@/server/auth";
import { createTestMarkets } from "@/server/testmarkets";

/** POST /api/admin/test-markets { count? = 8 } -> [Test] markets closing tonight with simulated trading. Admins only. */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const { count } = await readJson<{ count: number }>(req);
    return Response.json(await createTestMarkets(user, Number(count ?? 8)), { status: 201 });
  });
}
