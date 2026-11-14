"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

type Tab = { id: string; label: string; count?: number; body: ReactNode };

/** Tabs under the market chart (Activity, Top holders, Comments). Bodies are rendered on the server. */
export function MarketTabs({ tabs }: { tabs: Tab[] }) {
  const [active, setActive] = useState(tabs[0]?.id);
  return (
    <section className="rounded-2xl border border-line bg-panel">
      <div className="flex gap-1 border-b border-line px-2" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            onClick={() => setActive(t.id)}
            className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-semibold ${
              active === t.id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t.label}
            {t.count != null && <span className="ml-1.5 text-xs font-normal text-muted">{t.count}</span>}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" hidden={active !== t.id} className="p-4">
          {t.body}
        </div>
      ))}
    </section>
  );
}

export const ProfileLink = ({ userId, children }: { userId: string; children: ReactNode }) => (
  <Link href={`/u/${encodeURIComponent(userId)}`} className="flex min-w-0 items-center gap-2 hover:text-accent">
    {children}
  </Link>
);
