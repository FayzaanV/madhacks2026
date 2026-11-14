import { handle, readJson } from "@/server/api";
import { requestLogin, requestOrigin } from "@/server/auth";

/** POST /api/auth/request { email } -> emails a one-time sign-in link (demo mode returns it as devLink). */
export async function POST(req: Request) {
  return handle(async () => {
    const { email } = await readJson<{ email: string }>(req);
    return Response.json(await requestLogin(email, await requestOrigin()));
  });
}
