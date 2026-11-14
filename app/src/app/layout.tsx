import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { UserChip } from "@/components/user-chip";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Curve",
  description: "Bet your Clout, not your cash. A campus prediction market for UW-Madison.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <header className="border-b border-line bg-panel">
          <div className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
            <Link href="/" className="text-lg font-bold tracking-tight">
              The <span className="text-accent">Curve</span>
            </Link>
            <nav className="flex gap-4 text-sm text-muted">
              <Link href="/" className="hover:text-ink">Markets</Link>
              <Link href="/leaderboard" className="hover:text-ink">Leaderboard</Link>
              <Link href="/me" className="hover:text-ink">Profile</Link>
            </nav>
            <div className="ml-auto">
              <Suspense fallback={<span className="text-sm text-muted">…</span>}>
                <UserChip />
              </Suspense>
            </div>
          </div>
        </header>
        <div className="bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200 text-center text-xs py-1">
          Demo: market data is simulated. No real money anywhere. Clout only.
        </div>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
        <footer className="py-6 text-center text-xs text-muted">
          Ledger on Lakebase · analytics on Lakeflow + Unity Catalog · AI on Databricks Foundation Models
        </footer>
      </body>
    </html>
  );
}
