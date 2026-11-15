import Link from "next/link";
import { displayTitle } from "@/core/titles";
import { isAdmin } from "@/server/markets";
import { currentUser } from "@/server/user";
import { Avatar } from "./avatar";
import { nameClass } from "./cosmetics";
import { SignOutButton } from "./login-form";

export async function UserChip() {
  const u = await currentUser();
  if (!u)
    return (
      <Link href="/login" className="rounded-xl bg-accent px-4 py-1.5 text-sm font-semibold text-accent-ink">
        Sign in
      </Link>
    );
  if (!u.handle_chosen)
    return (
      <Link href="/welcome" className="rounded-xl bg-accent px-4 py-1.5 text-sm font-semibold text-accent-ink">
        Pick a username
      </Link>
    );
  const clout = Math.round(u.clout + u.open_stake);
  return (
    <span className="flex items-center gap-1">
      {isAdmin(u) && (
        <Link href="/markets/new" className="hidden rounded-lg px-3 py-1.5 text-sm font-semibold text-accent hover:bg-panel-2 sm:block">
          + New market
        </Link>
      )}
      <Link href="/portfolio" className="hidden rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-panel-2 hover:text-ink sm:block">
        Portfolio
      </Link>
      <Link
        href="/portfolio"
        className={`tabular rounded-xl px-3 py-1.5 text-sm font-semibold ${clout < 0 ? "bg-no-soft text-no" : "bg-accent text-accent-ink"}`}
      >
        {clout.toLocaleString()} <span className="font-normal opacity-80">Clout</span>
      </Link>
      <Link href="/me" className="flex items-center gap-2 rounded-xl px-1.5 py-1 hover:bg-panel-2" aria-label="Your profile">
        <Avatar userId={u.user_id} handle={u.handle} v={u.avatar_v} size={32} look={u.look} />
        <span className="hidden flex-col leading-tight lg:flex">
          <span className={`text-sm font-semibold ${nameClass(u.look)}`}>@{u.handle}</span>
          {/* Header uses tier titles only; flair needs a gold query, so it's validated on /me instead. */}
          <span className="text-[11px] text-accent">{u.title ?? displayTitle(null, clout)}</span>
        </span>
      </Link>
      <SignOutButton />
    </span>
  );
}
