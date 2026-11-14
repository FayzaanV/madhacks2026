import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Profile } from "@/components/profile";
import { openStakeSql, q } from "@/server/ledger";

export default function UserPage({ params }: PageProps<"/u/[id]">) {
  return (
    <Suspense fallback={<p className="text-muted">Loading profile…</p>}>
      <User params={params} />
    </Suspense>
  );
}

async function User({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await q<{ handle: string; clout: number; title: string | null; avatar_v: number | null }>(
    `SELECT u.handle, u.title, extract(epoch FROM u.avatar_updated_at)::int AS avatar_v, u.clout + ${openStakeSql("u.user_id")} AS clout
     FROM users u WHERE u.user_id = $1 AND u.deleted_at IS NULL`,
    [id],
  );
  if (!rows[0]) notFound();
  const r = rows[0];
  return <Profile userId={id} handle={r.handle} liveClout={r.clout} title={r.title} avatarV={r.avatar_v} />;
}
