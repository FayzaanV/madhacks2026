/** Clout everywhere, as a whole number (the ledger keeps exact values): negative renders red. */
export function Clout({ value, className = "" }: { value: number; className?: string }) {
  const v = Math.round(value);
  return (
    <span className={`tabular font-semibold ${v < 0 ? "text-down" : ""} ${className}`}>
      {v.toLocaleString()} <span className="text-xs font-normal text-muted">Clout</span>
    </span>
  );
}

export const pct = (p: number | null | undefined) => (p == null ? "–" : `${Math.round(p * 100)}%`);
