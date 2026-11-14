/** Clout everywhere: negative renders red. */
export function Clout({ value, className = "" }: { value: number; className?: string }) {
  const v = Math.round(value * 10) / 10;
  return (
    <span className={`tabular font-semibold ${v < 0 ? "text-no" : ""} ${className}`}>
      {v.toLocaleString(undefined, { maximumFractionDigits: 1 })} <span className="text-xs font-normal text-muted">Clout</span>
    </span>
  );
}

export const pct = (p: number | null | undefined) => (p == null ? "–" : `${Math.round(p * 100)}%`);
