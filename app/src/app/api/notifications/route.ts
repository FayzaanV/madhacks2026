import { handle } from "@/server/api";
import { requireUser } from "@/server/auth";
import { listNotifications, markAllRead } from "@/server/notify";

/** GET /api/notifications -> latest 30 + unread count. POST -> mark all read. */
export async function GET() {
  return handle(async () => Response.json(await listNotifications((await requireUser()).user_id)));
}

export async function POST() {
  return handle(async () => {
    await markAllRead((await requireUser()).user_id);
    return Response.json({ ok: true });
  });
}
