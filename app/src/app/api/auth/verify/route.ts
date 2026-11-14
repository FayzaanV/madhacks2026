import { cookies } from "next/headers";
import { handle, readJson } from "@/server/api";
import { SESSION_COOKIE, sessionCookieOptions, verifyLogin } from "@/server/auth";

/** POST /api/auth/verify { token } -> sets the session cookie. */
export async function POST(req: Request) {
  return handle(async () => {
    const { token } = await readJson<{ token: string }>(req);
    const { sessionId, maxAge, needsHandle } = await verifyLogin(token, req.headers.get("user-agent"));
    (await cookies()).set(SESSION_COOKIE, sessionId, sessionCookieOptions(maxAge));
    return Response.json({ ok: true, needsHandle });
  });
}
