"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { fmtDateTime } from "@/core/time";

type Item = { id: string; kind: string; ref_id: string | null; body: string; created_at: string; read: boolean };

/** Where a notification leads. */
const hrefFor = (n: Item) =>
  n.kind.startsWith("friend") ? "/friends" : n.kind === "group_invite" ? "/groups" : n.kind === "group_joined" ? `/groups/${n.ref_id}` : n.ref_id ? `/markets/${n.ref_id}` : "/friends";

/** Header bell: unread count; opening it loads the latest 30 and marks them read. */
export function NotificationBell({ unread: initial }: { unread: number }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initial);
  const [items, setItems] = useState<Item[] | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;
    const r = await fetch("/api/notifications").then((x) => x.json()).catch(() => null);
    setItems(r?.items ?? []);
    if (r?.unread) {
      await fetch("/api/notifications", { method: "POST" });
      setUnread(0);
    }
  }

  return (
    <div ref={box} className="relative">
      <button onClick={toggle} className="relative rounded-lg p-1.5 text-muted hover:bg-panel-2 hover:text-ink" aria-label={`Notifications (${unread} unread)`}>
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-no px-1 text-center text-[10px] font-bold leading-4 text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 overflow-hidden rounded-2xl border border-line bg-panel shadow-lg">
          <p className="border-b border-line px-4 py-2 text-sm font-semibold">Notifications</p>
          <ul className="max-h-96 overflow-y-auto">
            {items === null && <li className="px-4 py-3 text-sm text-muted">Loading…</li>}
            {items?.length === 0 && <li className="px-4 py-3 text-sm text-muted">Nothing yet.</li>}
            {items?.map((n) => (
              <li key={n.id}>
                <Link href={hrefFor(n)} onClick={() => setOpen(false)} className={`block px-4 py-2.5 text-sm hover:bg-panel-2 ${n.read ? "" : "bg-accent-soft/40"}`}>
                  <span className="block">{n.body}</span>
                  <span className="text-xs text-muted">{fmtDateTime(n.created_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
