import { redirect } from "next/navigation";
import { Suspense } from "react";
import { MarketForm } from "@/components/market-form";
import { isAdmin } from "@/server/markets";
import { currentUser } from "@/server/user";

export default function NewMarketPage() {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <NewMarket />
    </Suspense>
  );
}

async function NewMarket() {
  const u = await currentUser();
  if (!u) redirect("/login");
  if (!isAdmin(u))
    return <p className="rounded-2xl border border-line bg-panel p-6 text-sm text-muted">Creating markets is limited to admins for now.</p>;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">New market</h1>
      <p className="text-sm text-muted">Goes live immediately. Every outcome starts at an equal price.</p>
      <MarketForm />
    </div>
  );
}
