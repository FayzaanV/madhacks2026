import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Profile } from "@/components/profile";
import { q } from "@/server/ledger";

export default function UserPage({ params }: PageProps<"/u/[id]">) {
  return (
    <Suspense fallback={<p className="text-muted">Loading profile…</p>}>
      <User params={params} />
    </Suspense>
  );
}

async function User({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await q<{ handle: string; clout: number }>(
    `SELECT u.handle, u.clout + coalesce((SELECT sum(t.clout_spent) FROM trades t JOIN markets m USING (market_id)
       WHERE t.user_id = u.user_id AND m.status NOT IN ('resolved','final','voided')), 0)::float AS clout
     FROM users u WHERE u.user_id = $1 AND u.deleted_at IS NULL`,
    [id],
  );
  if (!rows[0]) notFound();
  return <Profile userId={id} handle={rows[0].handle} liveClout={rows[0].clout} />;
}
