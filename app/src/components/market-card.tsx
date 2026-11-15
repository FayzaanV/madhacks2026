import { fmtDate } from "@/core/time";
import Link from "next/link";
import type { Market } from "@/server/markets";
import { CourseIcon, Gauge, fmtClout } from "./ui";

const closes = (iso: string) => fmtDate(iso);

/** Compact board card. Binary: gauge + Yes/No. Multi: top outcomes with odds. */
export function MarketCard({ m, smartGap }: { m: Market; smartGap?: number }) {
  const href = `/markets/${m.market_id}`;
  const binary = m.outcomes.length === 2 && m.market_type === "binary";
  return (
    <article className="flex h-full flex-col rounded-2xl border border-line bg-panel p-4 transition hover:border-accent/60 hover:shadow-[0_0_0_1px_var(--accent-soft)]">
      <div className="flex items-start gap-3">
        <CourseIcon course={m.course} size={38} />
        <Link href={href} className="line-clamp-2 flex-1 text-[15px] font-semibold leading-snug hover:underline">
          {m.question}
        </Link>
        {binary && <Gauge p={m.outcomes[0].price} />}
      </div>

      {binary ? (
        <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
          <Link href={`${href}?pick=0`} className="rounded-lg bg-yes-soft py-2 text-center text-sm font-semibold text-yes hover:brightness-110">
            Yes
          </Link>
          <Link href={`${href}?pick=1`} className="rounded-lg bg-no-soft py-2 text-center text-sm font-semibold text-no hover:brightness-110">
            No
          </Link>
        </div>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {[...m.outcomes]
            .sort((a, b) => b.price - a.price)
            .slice(0, 3)
            .map((o) => (
              <li key={o.outcome_index} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate">{o.label}</span>
                <span className="tabular w-10 text-right font-bold">{Math.round(o.price * 100)}%</span>
                <Link
                  href={`${href}?pick=${o.outcome_index}`}
                  className="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent hover:brightness-110"
                >
                  Bet
                </Link>
              </li>
            ))}
        </ul>
      )}

      <div className="mt-3 flex items-center gap-2 text-xs text-muted">
        <span className="tabular">{fmtClout(m.volume)} Clout vol.</span>
        <span>·</span>
        <span>{m.course}</span>
        <span>·</span>
        <span>closes {closes(m.closes_at)}</span>
        {smartGap != null && smartGap >= 0.15 && (
          <span className="ml-auto rounded bg-accent-soft px-1.5 py-0.5 font-semibold text-smart">Smart $ disagrees</span>
        )}
      </div>
    </article>
  );
}
