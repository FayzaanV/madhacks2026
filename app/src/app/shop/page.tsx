import Link from "next/link";
import { Suspense } from "react";
import { ShopBoard } from "@/components/shop-board";
import { nextUnlock, parseEquipped } from "@/core/cosmetics";
import { unlockRates } from "@/server/cosmetics";
import { q } from "@/server/ledger";
import { currentUser } from "@/server/user";

export default function ShopPage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl border border-line bg-panel" />}>
      <Shop />
    </Suspense>
  );
}

async function Shop() {
  const u = await currentUser();
  const [rates, saved] = await Promise.all([
    unlockRates(),
    u ? q<{ cosmetics: string | null }>("SELECT cosmetics FROM users WHERE user_id = $1", [u.user_id]) : Promise.resolve([]),
  ]);
  const clout = u ? u.clout + u.open_stake : null;
  const next = clout === null ? null : nextUnlock(clout);

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-line bg-panel p-5">
        <h1 className="text-2xl font-bold">Clout Shop</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Nothing here costs anything. Items unlock when your Clout reaches their level and stay yours as long as you hold it. Drop
          below and the item comes off; climb back and it&apos;s on again automatically.
        </p>
        {u && clout !== null ? (
          <p className="mt-3 text-sm">
            You have <b className={`tabular ${clout < 0 ? "text-no" : ""}`}>{Math.round(clout).toLocaleString()} Clout</b>
            {next && (
              <>
                {" "}
                · <b>{next.name}</b> unlocks in <span className="tabular">{Math.ceil(next.min! - clout)}</span> more
              </>
            )}
          </p>
        ) : (
          <p className="mt-3 text-sm">
            <Link href="/login" className="font-semibold text-accent">Sign in</Link> to equip items.
          </p>
        )}
      </header>
      <ShopBoard
        me={u ? { user_id: u.user_id, handle: u.handle, avatar_v: u.avatar_v, clout: clout! } : null}
        initialEquipped={parseEquipped(saved[0]?.cosmetics)}
        rates={rates}
      />
      {Object.keys(rates).length > 0 && (
        <p className="text-xs text-muted">&ldquo;% have it&rdquo; = share of real forecasters (1+ trade) at that Clout right now, from the Lakebase ledger.</p>
      )}
    </div>
  );
}
