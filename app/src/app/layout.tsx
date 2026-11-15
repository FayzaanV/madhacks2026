import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CategoryTabs } from "@/components/category-tabs";
import { SearchBox } from "@/components/search-box";
import { SimTicker } from "@/components/sim-ticker";
import { UserChip } from "@/components/user-chip";
import "./globals.css";

export const metadata: Metadata = {
  title: "Yomi",
  description: "Bet your Clout, not your cash. A prediction market for college students, with leaderboards for every university.",
};

function Logo() {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2.5 font-extrabold tracking-tight">
      {/* <svg viewBox="0 0 24 24" className="h-8 w-8 text-accent drop-shadow-sm" aria-hidden>
        <rect x="1" y="1" width="22" height="22" rx="6" fill="currentColor" />
        <path d="M5 17 C9 17 9 7 13 7 S17 12 19 9" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
      </svg> */}
      <span className="text-4xl tracking-tight">Yomi</span>
    </Link>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <header className="sticky top-0 z-20 border-b border-line bg-panel/95 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
            <Logo />
            <Suspense fallback={<div className="hidden flex-1 md:block" />}>
              <SearchBox />
            </Suspense>
            <Link href="/help" className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold text-ink hover:bg-panel-2">
              Help
            </Link>
            <nav className="ml-auto flex shrink-0 items-center gap-1 text-sm">
              <Link href="/leaderboard" className="rounded-lg px-3 py-1.5 font-semibold text-ink hover:bg-panel-2">
                Leaderboard
              </Link>
              <Suspense fallback={<span className="px-3 text-sm text-muted">…</span>}>
                <UserChip />
              </Suspense>
            </nav>
          </div>
          <Suspense fallback={<div className="h-11" />}>
            <CategoryTabs />
          </Suspense>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">{children}</main>
        <SimTicker />
        <footer className="border-t border-line py-6 text-center text-xs text-muted">
          Simulated demo data · Clout only, no real money · Ledger on Lakebase · analytics on Lakeflow + Unity Catalog ·
          AI on Databricks Foundation Models
        </footer>
      </body>
    </html>
  );
}
