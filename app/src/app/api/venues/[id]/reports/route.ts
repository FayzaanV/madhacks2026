import { handle, readJson } from "@/server/api";
import { requireUser } from "@/server/auth";
import { addReport } from "@/server/union";

/** POST /api/venues/:id/reports { metric: "wait_min" | "line_len", value } -> student check-in (1 per venue per 15 min). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const user = await requireUser();
    const { metric, value } = await readJson<{ metric: string; value: number }>(req);
    return Response.json(await addReport(user.user_id, id, metric, value), { status: 201 });
  });
}
