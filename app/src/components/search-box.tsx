"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function SearchBox() {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  // Cmd+K (Mac) / Ctrl+K focuses the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form
      role="search"
      className="hidden min-w-0 flex-1 md:block"
      onSubmit={(e) => {
        e.preventDefault();
        const next = new URLSearchParams(sp);
        if (q.trim()) next.set("q", q.trim());
        else next.delete("q");
        router.push(`/?${next}`);
      }}
    >
      <label className="flex items-center gap-2 rounded-xl border border-transparent bg-panel-2 px-3 py-2.5 text-sm focus-within:border-accent focus-within:bg-panel">
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-muted" aria-hidden>
          <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M20 20l-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search markets, courses…"
          className="w-full bg-transparent outline-none placeholder:text-muted"
        />
        <kbd className="hidden shrink-0 rounded-md border border-line bg-panel px-1.5 py-0.5 text-[11px] font-medium text-muted lg:block">
          ⌘ K
        </kbd>
      </label>
    </form>
  );
}
