"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export function SearchBox() {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  return (
    <form
      role="search"
      className="hidden max-w-xl flex-1 md:block"
      onSubmit={(e) => {
        e.preventDefault();
        const next = new URLSearchParams(sp);
        if (q.trim()) next.set("q", q.trim());
        else next.delete("q");
        router.push(`/?${next}`);
      }}
    >
      <label className="flex items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2 text-sm focus-within:border-accent">
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-muted" aria-hidden>
          <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M20 20l-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search markets, courses…"
          className="w-full bg-transparent outline-none placeholder:text-muted"
        />
      </label>
    </form>
  );
}
