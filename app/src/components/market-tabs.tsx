"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

/** `real`/`realCount`: the same tab with simulated demo users filtered out (both versions rendered on the server). */
type Tab = { id: string; label: string; count?: number; body: ReactNode; real?: ReactNode; realCount?: number };

/** Tabs under the market chart (Activity, Top holders), with a "Real people only" toggle. */
export function MarketTabs({ tabs }: { tabs: Tab[] }) {
  const [active, setActive] = useState(tabs[0]?.id);
  const [realOnly, setRealOnly] = useState(false);
  const hasFilter = tabs.some((t) => t.real !== undefined);
  return (
    <section className="rounded-2xl border border-line bg-panel">
      <div className="flex items-center gap-1 border-b border-line px-2" role="tablist">
        {tabs.map((t) => {
          const count = realOnly && t.real !== undefined ? t.realCount : t.count;
          return (
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
              {count != null && <span className="ml-1.5 text-xs font-normal text-muted">{count}</span>}
            </button>
          );
        })}
        {hasFilter && (
          <label className="ml-auto flex cursor-pointer items-center gap-1.5 px-2 text-xs text-muted">
            <input type="checkbox" checked={realOnly} onChange={(e) => setRealOnly(e.target.checked)} className="accent-[var(--accent)]" />
            Real people only
          </label>
        )}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" hidden={active !== t.id} className="p-4">
          {realOnly && t.real !== undefined ? t.real : t.body}
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
