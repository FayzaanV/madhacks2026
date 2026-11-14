import { getAvatar } from "@/server/profile";

/** GET /api/users/:id/avatar -> the uploaded profile picture. URLs carry ?v=<version>, so it can be cached for good. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await getAvatar(id);
  if (!a) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(a.bytes), {
    headers: {
      "Content-Type": a.type,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
