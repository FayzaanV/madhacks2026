import { handle, readJson } from "@/server/api";
import { requestLogin, requestOrigin } from "@/server/auth";

/** POST /api/auth/request { email, school_id } -> emails a one-time sign-in link (demo mode returns it as devLink). */
export async function POST(req: Request) {
  return handle(async () => {
    const { email, school_id } = await readJson<{ email: string; school_id: string }>(req);
    return Response.json(await requestLogin(email, school_id, await requestOrigin()));
  });
}
