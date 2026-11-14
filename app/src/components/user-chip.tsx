import Link from "next/link";
import { currentUser } from "@/server/user";

export async function UserChip() {
  const u = await currentUser();
  const v = Math.round(u.clout * 10) / 10;
  return (
    <Link href="/me" className="flex items-center gap-2 rounded-xl bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink">
      <span className={`tabular ${v < 0 ? "rounded bg-white/90 px-1 text-no" : ""}`}>{v.toLocaleString()}</span>
      <span className="font-normal opacity-80">Clout</span>
      <span className="hidden opacity-80 sm:inline">· @{u.handle}</span>
    </Link>
  );
}
