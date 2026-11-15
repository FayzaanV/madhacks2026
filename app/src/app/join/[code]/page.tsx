import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { JoinButton } from "@/components/group-tools";
import { groupByCode } from "@/server/social";
import { currentUser } from "@/server/user";

export default function JoinPage({ params }: PageProps<"/join/[code]">) {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl border border-line bg-panel" />}>
      <Join params={params} />
    </Suspense>
  );
}

async function Join({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [g, me] = await Promise.all([groupByCode(code), currentUser()]);
  if (!g) notFound();
  return (
    <div className="mx-auto max-w-md space-y-3 rounded-2xl border border-line bg-panel p-6 text-center">
      <p className="text-sm text-muted">You&apos;re invited to a private group</p>
      <h1 className="text-2xl font-bold">{g.name}</h1>
      <p className="text-sm text-muted">{g.members} member{g.members === 1 ? "" : "s"}</p>
      {g.description && <p>{g.description}</p>}
      {me ? (
        <JoinButton code={code} />
      ) : (
        <Link href="/login" className="inline-block rounded-lg bg-accent px-5 py-2 font-semibold text-accent-ink">
          Sign in to join
        </Link>
      )}
    </div>
  );
}
