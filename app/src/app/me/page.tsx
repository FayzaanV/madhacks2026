import { redirect } from "next/navigation";
import { Suspense } from "react";
import { HandleForm } from "@/components/handle-form";
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
  if (!u.handle_chosen) redirect("/welcome");
  return (
    <div className="space-y-6">
      <Profile userId={u.user_id} handle={u.handle} liveClout={u.clout + u.open_stake} />
      <section className="max-w-md rounded-2xl border border-line bg-panel p-4">
        <h2 className="mb-2 font-semibold">Change username</h2>
        <HandleForm current={u.handle} />
      </section>
    </div>
  );
}
