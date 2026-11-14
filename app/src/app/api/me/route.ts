import { cookies } from "next/headers";
import { handle, readJson } from "@/server/api";
import { SESSION_COOKIE, deleteAccount, requireUser, setHandle } from "@/server/auth";
import { querySql } from "@/server/warehouse";

/** GET /api/me -> your balance from Lakebase plus Brier/rank from the gold tables. */
export async function GET() {
  return handle(async () => {
    const u = await requireUser();
    const gold = await querySql<{ brier: number | null; n_forecasts: number | null; rank: number | null }>(
      `SELECT b.brier, b.n_forecasts, l.rank FROM (SELECT :id AS user_id) x
       LEFT JOIN {catalog}.gold.user_brier b USING (user_id)
       LEFT JOIN {catalog}.gold.leaderboard l ON l.user_id = x.user_id AND l.scope = 'overall'`,
      { id: u.user_id },
    ).catch(() => []);
    return Response.json({
      user_id: u.user_id,
      handle: u.handle,
      handle_chosen: u.handle_chosen,
      school_id: u.school_id,
      email: u.email,
      clout: u.clout + u.open_stake,
      available: u.clout,
      open_stake: u.open_stake,
      ...(gold[0] ?? {}),
    });
  });
}

/** PATCH /api/me { handle } -> pick or change your username (409 if taken). */
export async function PATCH(req: Request) {
  return handle(async () => {
    const u = await requireUser();
    const body = await readJson<{ handle: string }>(req);
    return Response.json({ handle: await setHandle(u.user_id, body.handle) });
  });
}

/** DELETE /api/me -> delete your account (sessions revoked, profile anonymized, trades kept). */
export async function DELETE() {
  return handle(async () => {
    const u = await requireUser();
    await deleteAccount(u.user_id);
    (await cookies()).delete(SESSION_COOKIE);
    return Response.json({ ok: true });
  });
}
