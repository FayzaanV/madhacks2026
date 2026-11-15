import { connection } from "next/server";
import { handle } from "@/server/api";
import { latestFacilities } from "@/server/campus-data";

/** GET /api/campus/facilities -> current UW Rec Well counts (live feed, falling back to the last saved counts). */
export async function GET() {
  return handle(async () => {
    await connection();
    return Response.json({ facilities: await latestFacilities() });
  });
}
