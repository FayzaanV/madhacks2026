import { handle } from "@/server/api";
import { partnerForecasts, partnerFromRequest } from "@/server/union";

/** GET /api/partner/forecasts (Authorization: Bearer <partner key>) -> the crowd forecast for your venues, last 7 days. */
export async function GET() {
  return handle(async () => {
    const partner = await partnerFromRequest();
    return Response.json({ partner: partner.name, forecasts: await partnerForecasts(partner.venue_ids) });
  });
}
