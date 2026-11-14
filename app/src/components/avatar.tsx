import { colorFor } from "./ui";

/**
 * Profile picture: the uploaded image (served from Lakebase by /api/users/:id/avatar, cached by version), or
 * colored initials. Server-safe (no hooks).
 */
export function Avatar({ userId, handle, v, size = 28 }: { userId: string; handle: string; v?: number | null; size?: number }) {
  const style = { width: size, height: size };
  if (v)
    // eslint-disable-next-line @next/next/no-img-element -- tiny, already-resized image from our own route
    return <img src={`/api/users/${encodeURIComponent(userId)}/avatar?v=${v}`} alt="" style={style} className="shrink-0 rounded-full object-cover" />;
  return (
    <span
      aria-hidden
      style={{ ...style, background: colorFor(userId), fontSize: size * 0.42 }}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold uppercase text-white"
    >
      {handle.replace(/[^a-z0-9]/gi, "").slice(0, 1) || "?"}
    </span>
  );
}

/** "@handle · Title" line used next to bets, comments and holders. */
export function PersonLine({ handle, title }: { handle: string; title?: string | null }) {
  return (
    <span className="min-w-0 truncate">
      <span className="font-semibold">@{handle}</span>
      {title && <span className="ml-1.5 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">{title}</span>}
    </span>
  );
}
