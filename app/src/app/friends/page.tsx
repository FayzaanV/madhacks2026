import { redirect } from "next/navigation";
import { Suspense } from "react";
import { FriendsPanel } from "@/components/friends-panel";
import { listFriends, myChallenges } from "@/server/social";
import { currentUser } from "@/server/user";

export default function FriendsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-bold">Friends</h1>
        <p className="text-muted">Add friends, challenge them head-to-head, and invite them to your groups.</p>
      </div>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl border border-line bg-panel" />}>
        <Friends />
      </Suspense>
    </div>
  );
}

async function Friends() {
  const me = await currentUser();
  if (!me) redirect("/login");
  const [lists, challenges] = await Promise.all([listFriends(me), myChallenges(me)]);
  return <FriendsPanel me={me.user_id} {...lists} challenges={challenges} />;
}
