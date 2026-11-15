import { handle, readJson } from "@/server/api";
import { requireUser } from "@/server/auth";
import { resolveMarket, TradeError } from "@/server/markets";

/**
 * POST /api/markets/:id/resolve { outcome: number | "void", rationale?, override? }
 * override: true (admins) re-resolves an already settled market; balances move by the difference only.
 * Pays winners (1 Clout per winning share) or refunds everyone if voided, opens the 24h dispute window,
 * and starts the yomi-refresh job. Needs 500+ Clout (or an ADMIN_EMAILS account).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const user = await requireUser();
    const { outcome, rationale, override } = await readJson<{ outcome: number | "void"; rationale: string; override: boolean }>(req);
    if (outcome === undefined || outcome === null) throw new TradeError("Pick the winning outcome, or void the market.");
    const winner = outcome === "void" ? "void" : Number(outcome);
    return Response.json(await resolveMarket(user, id, winner, String(rationale ?? ""), { override: override === true }));
  });
}
