import Link from "next/link";
import { displayTitle } from "@/core/titles";
import { isAdmin } from "@/server/markets";
import { currentUser } from "@/server/user";
import { Avatar } from "./avatar";
import { nameClass } from "./cosmetics";
import { SignOutButton } from "./login-form";
import { NotificationBell } from "./notification-bell";
import { q } from "@/server/ledger";

const menuLink = "block rounded-lg px-3 py-2 text-sm font-medium text-ink hover:bg-panel-2";

export async function UserChip() {
  const u = await currentUser();
  if (!u)
    return (
      <span className="flex items-center gap-2 pl-1">
        <Link
          href="/login"
          className="rounded-xl border border-line bg-panel px-4 py-2 text-sm font-semibold text-ink hover:bg-panel-2"
        >
          Log in
        </Link>
        <Link
          href="/login"
          className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-ink shadow-card hover:brightness-95"
        >
          Sign up
        </Link>
      </span>
    );
  if (!u.handle_chosen)
    return (
      <Link href="/welcome" className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-ink hover:brightness-95">
        Pick a username
      </Link>
    );
  const clout = Math.round(u.clout + u.open_stake);
  const [{ n: unread }] = await q<{ n: number }>("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL", [
    u.user_id,
  ]).catch(() => [{ n: 0 }]);
  return (
    <span className="flex items-center gap-1.5">
      <Link
        href="/shop"
        className="hidden rounded-lg px-3 py-1.5 text-sm font-semibold text-ink hover:bg-panel-2 sm:block"
        title="Unlock hats, frames and name colors with your Clout"
      >
        <span aria-hidden>👑 </span>Shop
      </Link>
      {isAdmin(u) && (
        <Link
          href="/markets/new"
          className="hidden rounded-xl bg-accent px-3.5 py-1.5 text-sm font-semibold text-accent-ink hover:brightness-95 sm:block"
        >
          + New market
        </Link>
      )}
      <Link
        href="/portfolio"
        className={`tabular rounded-xl px-3 py-1.5 text-sm font-bold ${
          clout < 0 ? "bg-down-soft text-down" : "bg-accent-soft text-accent"
        }`}
      >
        {clout.toLocaleString()} <span className="font-medium opacity-80">Clout</span>
      </Link>
      <NotificationBell unread={unread} />
      {/* Menu is a plain <details>, so it stays a server component. It doesn't close on outside click yet. */}
      <details className="relative">
        <summary
          className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-1.5 py-1 hover:bg-panel-2 [&::-webkit-details-marker]:hidden"
          aria-label="Account menu"
        >
          <Avatar userId={u.user_id} handle={u.handle} v={u.avatar_v} size={32} look={u.look} />
          <span className="hidden flex-col leading-tight lg:flex">
            <span className={`text-sm font-semibold ${nameClass(u.look)}`}>@{u.handle}</span>
            {/* Header uses tier titles only; flair needs a gold query, so it's validated on /me instead. */}
            <span className="text-[11px] text-muted">{u.title ?? displayTitle(null, clout)}</span>
          </span>
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-muted" aria-hidden>
            <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </summary>
        <div className="absolute right-0 top-full z-30 mt-2 w-52 rounded-2xl border border-line bg-panel p-1.5 shadow-pop">
          <Link href="/me" className={menuLink}>
            Your profile
          </Link>
          <Link href="/portfolio" className={menuLink}>
            Portfolio
          </Link>
          <Link href="/friends" className={menuLink}>
            Friends
          </Link>
          <Link href="/groups" className={menuLink}>
            Groups
          </Link>
          <div className="my-1 border-t border-line" />
          <div className="px-1 py-1 text-sm">
            <SignOutButton />
          </div>
        </div>
      </details>
    </span>
  );
}
