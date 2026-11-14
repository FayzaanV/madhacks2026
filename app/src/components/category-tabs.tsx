"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/** Category row under the header. Categories filter the home board via ?cat=. */
const CATS = [
  { key: "", label: "Trending" },
  { key: "mispriced", label: "Smart Money alerts" },
  { key: "campus", label: "Campus" },
  { key: "CS", label: "Comp Sci" },
  { key: "Econ", label: "Econ" },
  { key: "Math", label: "Math" },
  { key: "Stat", label: "Stats" },
  { key: "Chem", label: "Chem" },
  { key: "Psych", label: "Psych" },
  { key: "closing", label: "Closing soon" },
];

export function CategoryTabs() {
  const path = usePathname();
  const sp = useSearchParams();
  const active = path === "/" ? (sp.get("cat") ?? "") : null;
  return (
    <nav className="no-scrollbar mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-2 text-sm">
      {CATS.map((c) => (
        <Link
          key={c.key || "all"}
          href={c.key ? `/?cat=${encodeURIComponent(c.key)}` : "/"}
          className={`shrink-0 rounded-lg px-3 py-1.5 font-medium ${
            active === c.key ? "bg-accent-soft text-accent" : "text-muted hover:text-ink"
          }`}
        >
          {c.label}
        </Link>
      ))}
    </nav>
  );
}
