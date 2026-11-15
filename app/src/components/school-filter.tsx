"use client";

import { useRouter } from "next/navigation";

/** University dropdown for the leaderboard. Changing it reloads the page with ?school=, keeping the tab and value. */
export function SchoolFilter({
  options,
  current,
  scope,
  value,
}: {
  options: { id: string; label: string }[];
  current: string; // a school id, or "all"
  scope: string;
  value?: string;
}) {
  const router = useRouter();
  return (
    <label className="flex w-fit items-center gap-2 text-sm">
      <span className="font-semibold text-muted">University</span>
      <select
        value={current}
        onChange={(e) => {
          const p = new URLSearchParams({ scope, school: e.target.value });
          if (value) p.set("value", value);
          router.push(`/leaderboard?${p}`);
        }}
        className="rounded-xl border border-line bg-panel px-3 py-2 font-medium text-ink outline-none focus:border-accent"
      >
        <option value="all">All schools</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
