import { redirect } from "next/navigation";
import { Suspense } from "react";
import { HandleForm } from "@/components/handle-form";
import { currentUser } from "@/server/user";

export default function WelcomePage() {
  return (
    <div className="mx-auto max-w-md py-10">
      <div className="rounded-2xl border border-line bg-panel p-6">
        <h1 className="text-2xl font-bold">Pick your username</h1>
        <p className="mb-4 mt-1 text-sm text-muted">
          This is how you&apos;ll appear on leaderboards and in comments. You have <b className="text-ink">100 Clout</b> to start.
        </p>
        <Suspense fallback={<div className="h-28" />}>
          <Form />
        </Suspense>
      </div>
    </div>
  );
}

async function Form() {
  const u = await currentUser();
  if (!u) redirect("/login");
  return <HandleForm current={u.handle_chosen ? u.handle : ""} next="/" cta="Start forecasting" />;
}
