import { redirect } from "next/navigation";
import { Suspense } from "react";
import { HandleForm } from "@/components/handle-form";
import { Profile } from "@/components/profile";
import { AvatarUpload, TitlePicker } from "@/components/profile-settings";
import { earnedTitles } from "@/core/titles";
import { userFlair } from "@/server/profile";
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
  const clout = u.clout + u.open_stake;
  const flair = (await userFlair(u.user_id)).map((f) => f.flair);
  return (
    <div className="space-y-6">
      <Profile userId={u.user_id} handle={u.handle} liveClout={clout} title={u.title} avatarV={u.avatar_v} />
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-2xl border border-line bg-panel p-4">
          <h2 className="mb-3 font-semibold">Profile picture</h2>
          <AvatarUpload userId={u.user_id} handle={u.handle} v={u.avatar_v} />
        </section>
        <section className="rounded-2xl border border-line bg-panel p-4">
          <h2 className="font-semibold">Title</h2>
          <p className="mb-3 text-xs text-muted">
            Earn titles by climbing Clout tiers (Market Maker at 250, Resolver at 500, Moderator at 1000) and from flair like
            &ldquo;Oracle of a course&rdquo;, computed by the Databricks pipeline.
          </p>
          <TitlePicker earned={earnedTitles(clout, flair)} current={u.title} />
        </section>
        <section className="rounded-2xl border border-line bg-panel p-4">
          <h2 className="mb-2 font-semibold">Change username</h2>
          <HandleForm current={u.handle} />
        </section>
      </div>
    </div>
  );
}
