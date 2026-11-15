import { handle } from "@/server/api";
import { ingestPartnerMetrics, partnerFromRequest } from "@/server/union";

/**
 * POST /api/partner/metrics (Authorization: Bearer <partner key>)
 * Body: [{ venue_id, metric: people|occupancy_pct|wait_min|line_len|sales, value, observed_at (ISO) }, ...] (max 1000)
 * Point-of-sale and sensor readings from an enterprise partner; they settle Union markets ahead of any other source.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const partner = await partnerFromRequest();
    const body = await req.json().catch(() => null);
    return Response.json({ partner: partner.name, ...(await ingestPartnerMetrics(partner, body)) });
  });
}
