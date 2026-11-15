import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CreateOrJoin } from "@/components/group-tools";
import { myGroups } from "@/server/social";
import { currentUser } from "@/server/user";

export default function GroupsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-bold">Groups</h1>
        <p className="text-muted">Private markets with your friends: your floor, your team, your study group. Only members can see them.</p>
      </div>
      <Suspense fallback={<div className="h-48 animate-pulse rounded-2xl border border-line bg-panel" />}>
        <Groups />
      </Suspense>
    </div>
  );
}

async function Groups() {
  const me = await currentUser();
  if (!me) redirect("/login");
  const groups = await myGroups(me);
  return (
    <div className="space-y-5">
      {groups.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <li key={g.group_id}>
              <Link href={`/groups/${g.group_id}`} className="block rounded-2xl border border-line bg-panel p-4 hover:border-accent">
                <span className="font-semibold">{g.name}</span>
                <span className="mt-0.5 block text-xs text-muted">
                  {g.members} member{g.members === 1 ? "" : "s"} · {g.role}
                </span>
                {g.description && <span className="mt-1 block text-sm text-muted">{g.description}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <CreateOrJoin />
    </div>
  );
}
