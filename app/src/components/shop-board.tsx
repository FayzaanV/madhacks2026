"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { activeLook, ITEMS, owns, progress, requirement, SLOTS, type Equipped, type Item, type Slot } from "@/core/cosmetics";
import { Avatar, PersonLine } from "./avatar";
import { Hat, nameClass } from "./cosmetics";

type Me = { user_id: string; handle: string; avatar_v: number | null; clout: number } | null;

/** The shop grid: live preview of your look, then one section per slot with lock/progress/equip per item. */
export function ShopBoard({ me, initialEquipped, rates }: { me: Me; initialEquipped: Equipped; rates: Record<string, number> }) {
  const router = useRouter();
  const [equipped, setEquipped] = useState<Equipped>(initialEquipped);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clout = me?.clout ?? 0;
  const look = activeLook(JSON.stringify(equipped), clout);

  async function choose(slot: Slot, item: string | null) {
    setBusy(item ?? slot);
    setError(null);
    const res = await fetch("/api/me/cosmetics", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot, item }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setError(j.error ?? "Couldn't equip that.");
    setEquipped((e) => {
      const n = { ...e };
      if (item === null) delete n[slot];
      else n[slot] = item;
      return n;
    });
    router.refresh(); // header avatar + name update
  }

  return (
    <div className="space-y-6">
      {me && (
        <section className="flex items-center gap-5 rounded-2xl border border-line bg-panel p-5 pt-10">
          <Avatar userId={me.user_id} handle={me.handle} v={me.avatar_v} size={72} look={look} />
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">Your look</div>
            <div className="text-lg">
              <PersonLine handle={me.handle} look={look} />
            </div>
            <p className="text-xs text-muted">This is how you appear next to your bets, comments and on the leaderboard.</p>
          </div>
        </section>
      )}
      {error && <p className="text-sm text-no">{error}</p>}

      {SLOTS.map(({ slot, label, hint }) => (
        <section key={slot}>
          <div className="mb-2 flex items-baseline gap-2">
            <h2 className="font-semibold">{label}</h2>
            <span className="text-xs text-muted">{hint}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {ITEMS.filter((i) => i.slot === slot).map((it) => (
              <ItemCard
                key={it.id}
                item={it}
                me={me}
                clout={clout}
                equipped={equipped[slot] === it.id}
                rate={rates[it.id]}
                busy={busy === it.id || busy === slot}
                onEquip={() => choose(slot, it.id)}
                onRemove={() => choose(slot, null)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ItemCard({
  item,
  me,
  clout,
  equipped,
  rate,
  busy,
  onEquip,
  onRemove,
}: {
  item: Item;
  me: Me;
  clout: number;
  equipped: boolean;
  rate?: number;
  busy: boolean;
  onEquip: () => void;
  onRemove: () => void;
}) {
  const have = me ? owns(item, clout) : false;
  const prog = me ? progress(item, clout) : 0;
  let action: React.ReactNode;
  if (!me) {
    action = <span className="text-xs text-muted">Sign in to equip</span>;
  } else if (equipped && have) {
    action = (
      <button onClick={onRemove} disabled={busy} className="w-full rounded-lg border border-accent py-1.5 text-xs font-semibold text-accent disabled:opacity-50">
        Equipped · Remove
      </button>
    );
  } else if (equipped) {
    action = <span className="text-xs text-muted">Equipped · comes back when you&apos;re eligible again</span>;
  } else if (have) {
    action = (
      <button onClick={onEquip} disabled={busy} className="w-full rounded-lg bg-accent py-1.5 text-xs font-semibold text-accent-ink disabled:opacity-50">
        Equip
      </button>
    );
  } else {
    action = (
      <div>
        <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(prog * 100)}%` }} />
        </div>
        <div className="mt-1 text-[11px] text-muted">🔒 {requirement(item)}</div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col rounded-2xl border bg-panel p-3 ${equipped && have ? "border-accent" : "border-line"} ${have || !me ? "" : "opacity-80"}`}>
      <div className="flex h-24 items-end justify-center pb-2">
        <Preview item={item} me={me} />
      </div>
      <div className="font-semibold">{item.name}</div>
      <p className="text-xs text-muted">{item.blurb}</p>
      <div className="mt-1 text-[11px] text-muted">
        {requirement(item)}
        {rate !== undefined && <> · {Math.round(rate * 100)}% have it</>}
      </div>
      <div className="mt-auto pt-3">{action}</div>
    </div>
  );
}

/** Each card shows the item on a neutral avatar (yours if signed in). */
function Preview({ item, me }: { item: Item; me: Me }) {
  const userId = me?.user_id ?? "preview";
  const handle = me?.handle ?? "you";
  if (item.slot === "color") return <span className={`text-lg font-bold ${nameClass({ color: item.id })}`}>@{handle}</span>;
  if (item.slot === "hat")
    return (
      <span className="relative inline-flex" style={{ width: 48, height: 48 }}>
        <Avatar userId={userId} handle={handle} v={me?.avatar_v} size={48} />
        <Hat id={item.id} size={48} />
      </span>
    );
  return <Avatar userId={userId} handle={handle} v={me?.avatar_v} size={48} look={{ frame: item.id }} />;
}
