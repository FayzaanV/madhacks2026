import { SLOTS, type Slot } from "@/core/cosmetics";
import { handle, readJson } from "@/server/api";
import { AuthError, requireUser } from "@/server/auth";
import { equipItem } from "@/server/cosmetics";

/**
 * PATCH /api/me/cosmetics { slot: "hat" | "frame" | "color", item: <item id> | null } -> equip a shop item you own
 * at your current true Clout (403 if not), or clear the slot with null. Returns { look }: what shows now.
 */
export async function PATCH(req: Request) {
  return handle(async () => {
    const u = await requireUser();
    const body = await readJson<{ slot: Slot; item: string | null }>(req);
    if (!SLOTS.some((s) => s.slot === body.slot)) throw new AuthError("Pick a slot: hat, frame or color.");
    const item = body.item === null || body.item === undefined ? null : String(body.item);
    return Response.json({ look: await equipItem(u, body.slot as Slot, item) });
  });
}
