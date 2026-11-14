import Link from "next/link";
import { currentUser } from "@/server/user";
import { SignOutButton } from "./login-form";

export async function UserChip() {
  const u = await currentUser();
  if (!u)
    return (
      <Link href="/login" className="rounded-xl bg-accent px-4 py-1.5 text-sm font-semibold text-accent-ink">
        Sign in
      </Link>
    );
  const clout = Math.round((u.clout + u.open_stake) * 10) / 10;
  return (
    <span className="flex items-center gap-1">
      <Link href="/me" className="flex items-center gap-2 rounded-xl bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink">
        <span className="tabular">{clout.toLocaleString()}</span>
        <span className="font-normal opacity-80">Clout</span>
        <span className="hidden opacity-80 sm:inline">· @{u.handle}</span>
      </Link>
      <SignOutButton />
    </span>
  );
}
