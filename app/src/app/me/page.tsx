import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Profile } from "@/components/profile";
import { currentUser } from "@/server/user";

export default function MePage() {
  return (
    <Suspense fallback={<p className="text-muted">Loading profile…</p>}>
      <Me />
    </Suspense>
  );
}

async function Me() {
  const u = await currentUser();
  if (!u) redirect("/login");
  return <Profile userId={u.user_id} handle={u.handle} liveClout={u.clout + u.open_stake} />;
}
