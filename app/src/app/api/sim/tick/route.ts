import { handle } from "@/server/api";
import { simTick } from "@/server/testmarkets";

/**
 * POST /api/sim/tick -> settle closed test markets and add a few simulated bets. Pinged by pages in the background;
 * throttled to once a minute per server, so it's safe to leave open.
 */
export async function POST() {
  return handle(async () => Response.json(await simTick()));
}
