import Link from "next/link";
import { currentUser } from "@/server/user";
import { Clout } from "./clout";

export async function UserChip() {
  const u = await currentUser();
  return (
    <Link href="/me" className="flex items-center gap-2 rounded-full border border-line px-3 py-1 text-sm">
      <span className="text-muted">@{u.handle}</span>
      <Clout value={u.clout} />
    </Link>
  );
}
