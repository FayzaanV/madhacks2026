"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/** Category row under the header. Categories filter the home board via ?cat=. */
const CATS: { key: string; label: string; href?: string; dot?: boolean }[] = [
  { key: "", label: "Trending" },
  { key: "campus", label: "Campus" },
  { key: "sports", label: "Sports", href: "/sports" },
  { key: "intramurals", label: "Intramurals", href: "/intramurals" },
  { key: "union", label: "Union", href: "/union" },
  { key: "CS", label: "Comp Sci" },
  { key: "Econ", label: "Econ" },
  { key: "Math", label: "Math" },
  { key: "Stat", label: "Stats" },
  { key: "Chem", label: "Chem" },
  { key: "Psych", label: "Psych" },
  { key: "closing", label: "Closing soon" },
  { key: "Test", label: "Test markets" },
];

export function CategoryTabs() {
  const path = usePathname();
  const sp = useSearchParams();
  const active =
    path === "/" ? (sp.get("cat") ?? "") : (["union", "sports", "intramurals"].find((k) => path.startsWith(`/${k}`)) ?? null);
  return (
    <nav className="no-scrollbar overflow-x-auto text-sm" aria-label="Market categories">
      <div className="mx-auto flex w-max gap-1 px-4">
        {CATS.map((c) => {
          const on = active === c.key;
          return (
            <Link
              key={c.key || "all"}
              href={c.href ?? (c.key ? `/?cat=${encodeURIComponent(c.key)}` : "/")}
              aria-current={on ? "page" : undefined}
              className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-3 font-semibold transition-colors ${
                on ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {c.label}
              {c.dot && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
